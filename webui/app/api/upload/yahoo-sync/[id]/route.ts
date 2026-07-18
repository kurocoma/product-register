import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product";
import { buildYahooLibFileName, validateYahooFileName } from "@/lib/yahoo";
import { processForCabinet } from "@/lib/image";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo";
import { uploadLibImage } from "@/lib/yahoo";

// sharp(native) と URL fetch のため Node ランタイム必須
export const runtime = "nodejs";

const MAX_BYTES = 30 * 1024 * 1024;

/** POST = 取込んだ実画像URL(image_url_1..image_count)を取得し、Yahoo追加画像(lib)へ転送する。
 *  楽天等から取込んだ商品を Yahoo に出すための画像準備（item_image_urls 不在による it-14091 対策）。
 *  ファイル名は editItem の item_image_urls と同じ規約（1枚目={ne_code}.jpg, 以降={ne_code}_{n}.jpg）。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cfg = getYahooConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  // 転送元: image_url_1..image_count（取込んだ実URL）。item_image_urls が参照する枚数ぶん揃える。
  const count = Math.max(1, Math.min(20, product.image_count || 1));
  const sources: { index: number; url: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const u = (product as unknown as Record<string, unknown>)[`image_url_${i}`];
    if (typeof u === "string" && u.trim()) sources.push({ index: i, url: u.trim() });
  }
  if (sources.length === 0) {
    return NextResponse.json(
      { ok: false, error: "転送元の画像URL(image_url_N)がありません。先にモールから取込むか、画像URLを設定してください。" },
      { status: 400 },
    );
  }

  let token: string;
  try {
    token = await getYahooAccessToken(cfg);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証）" }, { status: 502 });
  }

  const uploaded: { fileName: string; publicUrl: string }[] = [];
  const failed: { index: number; error: string }[] = [];
  for (const s of sources) {
    try {
      const target = buildYahooLibFileName(product, s.index);
      const valid = validateYahooFileName(target.fileName);
      if (!valid.ok) {
        failed.push({ index: s.index, error: valid.reason });
        continue;
      }
      const resp = await fetch(s.url);
      if (!resp.ok) {
        failed.push({ index: s.index, error: `画像取得失敗 (HTTP ${resp.status}): ${s.url}` });
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        failed.push({ index: s.index, error: "画像が大きすぎます" });
        continue;
      }
      const jpeg = await processForCabinet(buf, { kind: "main" });
      const up = await uploadLibImage(token, cfg.sellerId, { fileName: target.fileName, jpeg });
      if (up.ok) uploaded.push({ fileName: target.fileName, publicUrl: target.publicUrl });
      else failed.push({ index: s.index, error: up.message });
    } catch (e) {
      failed.push({ index: s.index, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const ok = uploaded.length > 0 && failed.length === 0;
  return NextResponse.json({ ok, uploaded, failed, total: sources.length });
}
