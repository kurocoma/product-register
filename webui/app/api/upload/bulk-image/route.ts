import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import type { ProductInput } from "@/lib/product/schema";
import { buildCabinetFileName, validateCabinetFileName } from "@/lib/converters/cabinet-path";
import { processForCabinet } from "@/lib/image/process";
import { insertCabinetFile } from "@/lib/rakuten/cabinet-client";
import { createQpsPacer, isQpsLimit } from "@/lib/rakuten/qps-retry";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { DEFAULT_RAKUTEN_STORE, RCABINET_FOLDER, rakutenCabinetBase } from "@/lib/rakuten/store";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo/auth";
import { uploadLibImage } from "@/lib/yahoo/lib-image-client";
import { uploadItemImage } from "@/lib/yahoo/item-image-client";
import {
  buildYahooLibFileNameByCode,
  buildYahooItemImageFileName,
  validateYahooFileName,
} from "@/lib/yahoo/lib-path";
import { getShopifyConfig } from "@/lib/shopify/auth";
import { uploadProductImage, uploadStoreFile } from "@/lib/shopify/media-client";

// sharp(native) と FormData/Blob を使うため Node ランタイム必須
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

type Mall = "rakuten" | "yahoo_item" | "yahoo_lib" | "shopify";

/** 商品コード末尾の連番("-1"等)を除いた基底。DB未登録の新規商品コードで
 * 楽天の2枚目以降規約({base}_{n})を近似する（Yahoo grouping-id と同じ規則）。 */
function codeBaseOf(code: string): string {
  const idx = code.lastIndexOf("-");
  if (idx === -1) return code;
  return /^\d+$/.test(code.slice(idx + 1)) ? code.slice(0, idx) : code;
}

/** 画像一括アップロード（260711修正依頼-4）: 1リクエスト = 1画像 × 1モール。
 * FormData:
 *  - file:   画像ファイル
 *  - mall:   rakuten | yahoo_item | yahoo_lib | shopify
 *  - index:  並び位置(1..20)。ファイル名の連番に使う
 *  - productId: 保存済み商品のID（任意）
 *  - code:      商品コード直接入力（productId 無しの新規商品先行アップロード用）
 *  - rakutenFolderId / rakutenFolderPath: 楽天の投入先（省略時 thum02）
 *  - yahooLibDir: Yahoo追加画像のディレクトリ（省略時 thum02）
 * 商品は productId → DBの ne_code 完全一致 → code 文字列のみ、の順で解決する。 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const form = await req.formData();
  const mall = String(form.get("mall") || "") as Mall;
  if (!["rakuten", "yahoo_item", "yahoo_lib", "shopify"].includes(mall)) {
    return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
  }
  const index = Number(form.get("index") || 1);
  if (!Number.isInteger(index) || index < 1 || index > 20) {
    return NextResponse.json({ ok: false, error: "並び位置は 1〜20 の整数で指定してください" }, { status: 400 });
  }
  // 画像ソース: file（D&D/選択したローカルファイル）または sourceUrl（「現在の画像を読み込む」で
  // 取り込んだモール現物のURL。モール画像はブラウザから CORS で取れないためサーバ側で取得する）
  const file = form.get("file");
  const sourceUrl = String(form.get("sourceUrl") || "").trim();
  let source: Buffer;
  if (file instanceof File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "画像が大きすぎます（30MB以内）" }, { status: 413 });
    }
    source = Buffer.from(await file.arrayBuffer());
  } else if (sourceUrl) {
    if (!/^https?:\/\//i.test(sourceUrl)) {
      return NextResponse.json({ ok: false, error: "画像URLは http(s) のみ指定できます" }, { status: 400 });
    }
    const resp = await fetch(sourceUrl);
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: `画像取得失敗 (HTTP ${resp.status}): ${sourceUrl}` }, { status: 400 });
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "画像が大きすぎます（30MB以内）" }, { status: 413 });
    }
    source = buf;
  } else {
    return NextResponse.json({ ok: false, error: "画像ファイルがありません" }, { status: 400 });
  }

  // 商品解決: productId 優先 → ne_code 完全一致 → コード文字列のみ（DB未登録の先行アップロード）
  const productId = String(form.get("productId") || "").trim();
  const codeInput = String(form.get("code") || "").trim();
  let product: ProductInput | null = null;
  if (productId) {
    const row = await getProduct(supabase, productId);
    if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
    product = dbRowToProductInput(row);
  } else if (codeInput) {
    const { data } = await supabase.from("products").select("*").eq("ne_code", codeInput).limit(1);
    if (data && data.length > 0) product = dbRowToProductInput(data[0]);
  }
  const code = product?.ne_code || codeInput;
  if (!code) {
    return NextResponse.json({ ok: false, error: "商品を選択するか、商品コードを入力してください" }, { status: 400 });
  }

  // 画像整形（EXIF回転・3840px・白背景・2MB以内JPEG。全モール共通）
  let jpeg: Buffer;
  try {
    jpeg = await processForCabinet(source, { kind: "main" });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "画像の変換に失敗しました: " + (e instanceof Error ? e.message : String(e)) },
      { status: 400 },
    );
  }

  if (mall === "rakuten") {
    const cred = getRakutenCredentialsFromEnv();
    if (!cred) return NextResponse.json({ ok: false, error: "楽天認証情報が未設定です" }, { status: 500 });
    // 投入先フォルダ（省略時は thum02）。UI が /api/rcabinet/folders の folderId を渡す
    const folderId = Number(form.get("rakutenFolderId") || RCABINET_FOLDER.thum02.folderId);
    const folderPath = String(form.get("rakutenFolderPath") || RCABINET_FOLDER.thum02.path);
    // ファイル名: DB商品があれば既存規約(2枚目以降 {base}_{n})、無ければコード基底で近似
    const name = product
      ? buildCabinetFileName(product, { kind: "main", index }).name
      : index <= 1
        ? code
        : `${codeBaseOf(code)}_${index}`;
    const valid = validateCabinetFileName(name);
    if (!valid.ok) return NextResponse.json({ ok: false, error: valid.reason }, { status: 400 });
    const filePath = `${name}.jpg`;
    // 1リクエスト1枚だが、クライアントの連続実行で QPSLimit を踏み得るためリトライで吸収する
    const result = await createQpsPacer()(
      () => insertCabinetFile(cred, { folderId, filePath, fileName: name, jpeg, overWrite: true }),
      (r) => !r.ok && isQpsLimit(r.message),
    );
    if (!result.ok) return NextResponse.json({ ok: false, error: "R-Cabinet アップロード失敗: " + result.message }, { status: 502 });
    const publicUrl = `${rakutenCabinetBase(DEFAULT_RAKUTEN_STORE, folderPath.replace(/^\//, ""))}/${filePath}`;
    return NextResponse.json({ ok: true, mall, fileName: filePath, publicUrl });
  }

  if (mall === "yahoo_item" || mall === "yahoo_lib") {
    const cfg = getYahooConfig();
    if (!cfg) return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });
    let token: string;
    try {
      token = await getYahooAccessToken(cfg);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証）" },
        { status: 502 },
      );
    }
    if (mall === "yahoo_item") {
      const fileName = buildYahooItemImageFileName(code, index);
      const valid = validateYahooFileName(fileName);
      if (!valid.ok) return NextResponse.json({ ok: false, error: valid.reason }, { status: 400 });
      const up = await uploadItemImage(token, cfg.sellerId, { fileName, jpeg });
      if (!up.ok) return NextResponse.json({ ok: false, error: "Yahoo 商品画像アップロード失敗: " + up.message }, { status: 502 });
      return NextResponse.json({ ok: true, mall, fileName, needsPublish: true });
    }
    const target = buildYahooLibFileNameByCode(code, index);
    const valid = validateYahooFileName(target.fileName);
    if (!valid.ok) return NextResponse.json({ ok: false, error: valid.reason }, { status: 400 });
    const directory = String(form.get("yahooLibDir") || "thum02");
    const up = await uploadLibImage(token, cfg.sellerId, { fileName: target.fileName, jpeg, directory });
    if (!up.ok) return NextResponse.json({ ok: false, error: "Yahoo 追加画像アップロード失敗: " + up.message }, { status: 502 });
    return NextResponse.json({ ok: true, mall, fileName: target.fileName, publicUrl: target.publicUrl });
  }

  // shopify: 連携済み（shopify_product_id あり）は商品メディアへ直接追加、
  // 未連携は「コンテンツ > ファイル」へ単独アップロード（後から商品に割り当て可能。260712修正依頼）
  const scfg = getShopifyConfig();
  if (!scfg) return NextResponse.json({ ok: false, error: "Shopify 認証情報が未設定です" }, { status: 500 });
  const gid = product?.shopify_product_id?.trim();
  const fileName = index <= 1 ? `${code}.jpg` : `${code}_${index}.jpg`;
  if (gid) {
    const up = await uploadProductImage(scfg, { productGid: gid, fileName, jpeg, alt: code });
    if (!up.ok) return NextResponse.json({ ok: false, error: "Shopify 画像アップロード失敗: " + up.message }, { status: 502 });
    return NextResponse.json({ ok: true, mall, fileName });
  }
  const up = await uploadStoreFile(scfg, { fileName, jpeg, alt: code });
  if (!up.ok) return NextResponse.json({ ok: false, error: "Shopify ファイルアップロード失敗: " + up.message }, { status: 502 });
  return NextResponse.json({ ok: true, mall, fileName, standalone: true });
}
