import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { buildCabinetFileName, validateCabinetFileName } from "@/lib/converters/cabinet-path";
import { processForCabinet } from "@/lib/image/process";
import { insertCabinetFile } from "@/lib/rakuten/cabinet-client";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { DEFAULT_RAKUTEN_STORE, rakutenCabinetBase } from "@/lib/rakuten/store";

// sharp(native) と FormData/Blob を使うため Node ランタイム必須（Edge不可）
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 誤操作による巨大ファイルのメモリ展開を防ぐ上限

/** 商品画像を R-Cabinet へアップロードする。
 * FormData: productId, kind("main"|"wb"), index(main時の何枚目), file(画像)
 * 成功時: { ok:true, publicUrl, fileId, name } */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: "R-Cabinet 資格情報が未設定です（.env.local の RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY）" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const productId = String(form.get("productId") || "");
  const kind = String(form.get("kind") || "main") === "wb" ? "wb" : "main";
  const index = Number(form.get("index") || 1);
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "画像ファイルがありません" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: `画像が大きすぎます（${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB以内）` }, { status: 413 });
  }
  if (kind === "main" && (!Number.isInteger(index) || index < 1 || index > 20)) {
    return NextResponse.json({ ok: false, error: "何枚目かは 1〜20 の整数で指定してください" }, { status: 400 });
  }

  // 対象商品を取得（RLS により本人の商品のみ）
  const row = await getProduct(supabase, productId);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  // 命名規約から投入先フォルダ・確定ファイル名を算出
  const target = kind === "wb"
    ? buildCabinetFileName(product, { kind: "wb" })
    : buildCabinetFileName(product, { kind: "main", index });

  const valid = validateCabinetFileName(target.name);
  if (!valid.ok) return NextResponse.json({ ok: false, error: valid.reason }, { status: 400 });

  // R-Cabinet 制約へ整形（2MB/3840px/JPEG/白背景）
  const input = Buffer.from(await file.arrayBuffer());
  let jpeg: Buffer;
  try {
    jpeg = await processForCabinet(input, { kind });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "画像の変換に失敗しました: " + (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }

  // アップロード（同名は上書き）
  const result = await insertCabinetFile(cred, {
    folderId: target.folderId,
    filePath: target.filePath,
    fileName: target.name,
    jpeg,
    overWrite: true,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "R-Cabinet アップロード失敗: " + result.message }, { status: 502 });
  }

  const publicUrl = `${rakutenCabinetBase(DEFAULT_RAKUTEN_STORE, target.folder)}/${target.filePath}`;
  return NextResponse.json({ ok: true, publicUrl, fileId: result.fileId, name: target.name, folder: target.folder });
}
