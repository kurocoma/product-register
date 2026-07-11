import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { getItem } from "@/lib/rakuten/item-client";
import { parseRakutenItem } from "@/lib/converters/rakuten-item-parser";
import { buildRakutenManageNumber } from "@/lib/converters/rakuten-api";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";

/** GET ?productId={DB商品ID} または ?code={商品管理番号} =
 * 楽天に登録済みの商品画像URLを現在の並び順で返す（読み取りのみ）。
 * DB商品は buildRakutenManageNumber で引く（管理番号≠NEコードの商品対応。rcabinet-sync と同じ規則）。
 * /bulk-images の「現在の画像を読み込む」用（260712修正依頼: 現物の並びで差し替え・並べ替え・削除）。 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const url = new URL(req.url);
  const productId = url.searchParams.get("productId")?.trim();
  let code = url.searchParams.get("code")?.trim() || "";
  if (productId) {
    const row = await getProduct(supabase, productId);
    if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
    code = buildRakutenManageNumber(dbRowToProductInput(row));
  }
  if (!code) return NextResponse.json({ ok: false, error: "商品コードを指定してください" }, { status: 400 });

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) return NextResponse.json({ ok: false, error: "楽天認証情報が未設定です" }, { status: 500 });

  const got = await getItem(cred, code);
  if (!got.exists || !got.json) {
    return NextResponse.json({ ok: false, error: `楽天に商品が見つかりません（管理番号: ${code}）` }, { status: 404 });
  }

  // parseRakutenItem が images[].location を公開URL(image_url_1..N)へ変換済み
  const parsed = parseRakutenItem(got.json);
  const images: string[] = [];
  const count = Math.min(20, parsed.image_count || 0);
  for (let i = 1; i <= count; i++) {
    const u = (parsed as unknown as Record<string, unknown>)[`image_url_${i}`];
    if (typeof u === "string" && u.trim()) images.push(u.trim());
  }
  return NextResponse.json({ ok: true, code, images });
}
