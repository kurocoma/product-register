import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertProduct } from "@/lib/product/repository";
import type { ProductInput } from "@/lib/product/schema";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { getItem as getRakutenItem, searchManageNumberBySku } from "@/lib/rakuten/item-client";
import { parseRakutenItem, parseRakutenVariants } from "@/lib/converters/rakuten-item-parser";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo/auth";
import { getItem as getYahooItem } from "@/lib/yahoo/item-client";
import { parseYahooItem } from "@/lib/converters/yahoo-item-parser";
import { buildImportedProduct } from "@/lib/converters/mall-import";

export const runtime = "nodejs";

/** POST = 管理番号を入力してモール既存商品を取込み、アプリに新規商品として作成する。
 *  同じ NEコードの商品が既にあれば作成せずそれを開かせる（重複作成防止）。 */
export async function POST(req: Request, { params }: { params: Promise<{ mall: string }> }) {
  const { mall } = await params;
  if (mall !== "rakuten" && mall !== "yahoo") {
    return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let code = "";
  try {
    const body = (await req.json()) as { code?: unknown };
    code = typeof body?.code === "string" ? body.code.trim() : "";
  } catch {
    /* 空ボディ */
  }
  if (!code) return NextResponse.json({ ok: false, error: "商品管理番号を入力してください" }, { status: 400 });

  // 1) モールから getItem → editable subset へパース
  let parsed: Partial<ProductInput>;
  let resolvedCode = code; // 楽天は SKU検索で実管理番号に解決することがある（rakuten_manage_number に使う）
  if (mall === "rakuten") {
    const cred = getRakutenCredentialsFromEnv();
    if (!cred) return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });
    let got = await getRakutenItem(cred, code);
    let targetSku: string | undefined; // SKU検索で解決した場合、取込むべき variant の merchantDefinedSkuId(=入力code)
    if (!got.exists || !got.json) {
      // フォールバック: 入力が管理番号でなくシステム連携用SKU番号(=NEコード)の場合、検索で管理番号を引き当てる
      const mn = await searchManageNumberBySku(cred, code);
      if (mn) {
        got = await getRakutenItem(cred, mn);
        resolvedCode = mn;
        targetSku = code; // 多SKU商品では、検索した SKU の variant を選んで parse する
      }
    }
    if (!got.exists || !got.json) {
      return NextResponse.json({ ok: false, error: `楽天に「${code}」の商品が見つかりません（管理番号・システム連携用SKU番号いずれも該当なし。検索反映は最大24h遅延）` }, { status: 404 });
    }
    const p = parseRakutenItem(got.json, targetSku ? { merchantSku: targetSku } : undefined);
    delete (p as { _variantId?: string })._variantId;
    // 多SKU(P2): 1商品ページ配下の全SKUを variants[] に取込む（編集画面でまとめて価格・配送改定するため）。
    p.variants = parseRakutenVariants(got.json);
    parsed = p;
  } else {
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
    const got = await getYahooItem(token, cfg.sellerId, code);
    if (!got.exists) {
      return NextResponse.json({ ok: false, error: `Yahoo に商品コード「${code}」の商品が見つかりません` }, { status: 404 });
    }
    parsed = parseYahooItem(got.raw);
  }

  // 2) 完全な ProductInput を構築（識別子整合・JAN13桁を担保。失敗時は手動作成を促す）
  //    楽天で SKU検索により管理番号を解決した場合は、解決後の管理番号を rakuten_manage_number に使う。
  const built = buildImportedProduct(mall, resolvedCode, parsed);
  if (!built.ok) return NextResponse.json({ ok: false, error: built.error }, { status: 422 });
  // 取込元モールを掲載済みに記録（反映ボタンの活性判定に使う）。
  built.product.mall_listed = { ...built.product.mall_listed, [mall]: true };

  // 3) 既存照合（あれば作成せず既存を開かせる）
  //    楽天は「1商品ページ=1商品(多SKU)」なので、まず商品管理番号(ページ)で照合する。
  //    同ページの別SKUを取り込んでも同一商品を開き、ページの二重作成を防ぐ。次に NEコードで照合。
  const existing = await findExistingProduct(supabase, user.id, mall, built.product.rakuten_manage_number, built.neCode);
  if (existing?.id) {
    return NextResponse.json({ ok: true, existed: true, productId: existing.id, neCode: built.neCode });
  }

  // 4) 新規作成
  let saved;
  try {
    saved = await upsertProduct(supabase, built.product);
  } catch (e) {
    // 同一 NEコードの同時 POST 競合（check-then-insert の TOCTOU）で UNIQUE 制約に弾かれた場合、
    // 既に作成済みの商品が存在するはず。再照合して存在すれば既存パスと同じく existed:true で開かせる
    // （冪等性: 二重作成は DB 制約で防がれており、敗者リクエストを 500 で落とさない）。
    const raced = await findExistingProduct(supabase, user.id, mall, built.product.rakuten_manage_number, built.neCode);
    if (raced?.id) {
      return NextResponse.json({ ok: true, existed: true, productId: raced.id, neCode: built.neCode });
    }
    return NextResponse.json(
      { ok: false, error: "商品の作成に失敗しました: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, existed: false, productId: saved.id, neCode: built.neCode });
}

/** 既存商品の照合。楽天は商品管理番号(ページ)優先→NEコード。多SKUの同ページ二重作成を防ぐ。
 * rakuten_manage_number は extra(JSON)なので extra->>rakuten_manage_number で絞る。
 * 同ページに複数レコードが残る旧データもあり得るため limit(1)（maybeSingleは複数行で例外になる）。 */
async function findExistingProduct(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  mall: string,
  manageNumber: string,
  neCode: string,
): Promise<{ id: string } | null> {
  if (mall === "rakuten" && manageNumber) {
    const { data } = await supabase
      .from("products")
      .select("id")
      .eq("user_id", userId)
      .eq("extra->>rakuten_manage_number", manageNumber)
      .limit(1);
    if (data && data.length) return data[0] as { id: string };
  }
  const { data } = await supabase
    .from("products")
    .select("id")
    .eq("user_id", userId)
    .eq("ne_code", neCode)
    .limit(1);
  return data && data.length ? (data[0] as { id: string }) : null;
}
