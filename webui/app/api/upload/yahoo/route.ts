import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product";
import { buildYahooLibFileName, validateYahooFileName } from "@/lib/yahoo";
import { processForCabinet } from "@/lib/image";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo";
import { uploadLibImage } from "@/lib/yahoo";

// sharp(native) と FormData/Blob のため Node ランタイム必須
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 誤操作による巨大ファイルのメモリ展開を防ぐ上限

/** 商品画像を Yahoo!ショッピングの追加画像(lib)へアップロードする。
 * FormData: productId, index(何枚目), file(画像)
 * 成功時: { ok:true, publicUrl, name } */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cfg = getYahooConfig();
  if (!cfg) {
    return NextResponse.json(
      { ok: false, error: "Yahoo 認証情報が未設定です（.env.local の YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET / YAHOO_REFRESH_TOKEN / SELLER_ID）" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const productId = String(form.get("productId") || "");
  const index = Number(form.get("index") || 1);
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "画像ファイルがありません" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: `画像が大きすぎます（${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB以内）` }, { status: 413 });
  }
  if (!Number.isInteger(index) || index < 1 || index > 20) {
    return NextResponse.json({ ok: false, error: "何枚目かは 1〜20 の整数で指定してください" }, { status: 400 });
  }

  const row = await getProduct(supabase, productId);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const target = buildYahooLibFileName(product, index);
  const valid = validateYahooFileName(target.fileName);
  if (!valid.ok) return NextResponse.json({ ok: false, error: valid.reason }, { status: 400 });

  // 2MB/JPEG へ整形（Yahoo は GIF/PNG/JPEG・2MB以下。透過は白で平坦化）
  const input = Buffer.from(await file.arrayBuffer());
  let jpeg: Buffer;
  try {
    jpeg = await processForCabinet(input, { kind: "main" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "画像の変換に失敗しました: " + (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }

  // アクセストークン取得 → アップロード
  let token: string;
  try {
    token = await getYahooAccessToken(cfg);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証が必要）" }, { status: 502 });
  }

  const result = await uploadLibImage(token, cfg.sellerId, { fileName: target.fileName, jpeg });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Yahoo アップロード失敗: " + result.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, publicUrl: target.publicUrl, name: target.name, fileName: target.fileName });
}
