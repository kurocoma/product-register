import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRakutenCredentialsFromEnv, searchItemsByTitle } from "@/lib/rakuten";
import { getYahooConfig, searchStoreItemsByName } from "@/lib/yahoo";
import { getShopifyConfig, searchProductsByTitle } from "@/lib/shopify";

export const runtime = "nodejs";

/** 検索候補（モール共通形）。code はそのまま取込（POST /api/import/[mall]）に使える形:
 * 楽天=商品管理番号 / Yahoo=商品コード / Shopify=数値ID。 */
export type ImportSearchResult = { code: string; name: string; note?: string };

const SHOPIFY_STATUS_LABEL: Record<string, string> = {
  DRAFT: "下書き",
  ARCHIVED: "アーカイブ",
};

/** GET ?q= — モール既存商品を商品名で検索し、取込候補（code + 商品名）を返す（260901修正依頼-1）。
 * 書き込みなし。結果の code を POST /api/import/[mall] へ渡すと従来どおり取込める。 */
export async function GET(req: Request, { params }: { params: Promise<{ mall: string }> }) {
  const { mall } = await params;
  if (mall !== "rakuten" && mall !== "yahoo" && mall !== "shopify") {
    return NextResponse.json({ ok: false, error: "不正なモール指定です" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ ok: false, error: "商品名を入力してください" }, { status: 400 });

  if (mall === "rakuten") {
    const cred = getRakutenCredentialsFromEnv();
    if (!cred) return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });
    const r = await searchItemsByTitle(cred, q);
    if (!r.ok) return NextResponse.json({ ok: false, error: "楽天の検索に失敗: " + (r.message ?? "") }, { status: 502 });
    const results: ImportSearchResult[] = r.results.map((i) => ({
      code: i.manageNumber,
      name: i.title,
      ...(i.hideItem ? { note: "倉庫（非公開）" } : {}),
    }));
    return NextResponse.json({ ok: true, mall, results, hint: "検索インデックスの反映は最大24時間遅れることがあります" });
  }

  if (mall === "shopify") {
    const scfg = getShopifyConfig();
    if (!scfg) {
      return NextResponse.json(
        { ok: false, error: "Shopify 認証情報が未設定です（SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET）" },
        { status: 500 },
      );
    }
    const r = await searchProductsByTitle(scfg, q);
    if (!r.ok) return NextResponse.json({ ok: false, error: "Shopify の検索に失敗: " + (r.message ?? "") }, { status: 502 });
    const results: ImportSearchResult[] = r.hits.map((h) => ({
      code: h.numericId,
      name: h.title,
      ...(SHOPIFY_STATUS_LABEL[h.status] ? { note: SHOPIFY_STATUS_LABEL[h.status] } : {}),
    }));
    return NextResponse.json({ ok: true, mall, results });
  }

  const cfg = getYahooConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });
  const r = await searchStoreItemsByName(cfg.clientId, cfg.sellerId, q);
  if (!r.ok) return NextResponse.json({ ok: false, error: "Yahoo の検索に失敗: " + (r.message ?? "") }, { status: 502 });
  const results: ImportSearchResult[] = r.hits.map((h) => ({
    code: h.itemCode,
    name: h.name,
    ...(h.price != null ? { note: `税込${h.price.toLocaleString()}円` } : {}),
  }));
  return NextResponse.json({
    ok: true,
    mall,
    results,
    hint: "Yahoo の商品名検索は公開中（検索反映済み）の商品のみが対象です。非公開の商品は商品コードで取込んでください",
  });
}
