import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbRowToProductInput, type ProductRow } from "@/lib/product";
import { buildMallLinkEntries, type MallLinkEntry } from "@/lib/converters";

/** しまのや全商品の楽天/Yahoo 公開ページリンク一覧。
 * - 未ログイン・スマホ閲覧前提の読取専用ページ（proxy.ts で /links を認証除外）。
 * - データは Service Role で SSR 読取（RLS 対象外・鍵はサーバのみ。lib/supabase/admin.ts）。
 * - #links-data の JSON は E2E（tests/e2e_shimanoya_links.mjs）が機械可読データとして読む。
 *   形を変えるときは E2E とセットで変えること。 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "しまのや 商品リンク一覧",
  robots: { index: false, follow: false },
};

/** しまのや＝メーカーコード s071（config/master/maker_codes.csv 72行目）。
 * 保存揺れに備え maker_code / NEコード接頭辞 / extra.maker_name の3条件で拾う。 */
const MAKER_FILTER = "maker_code.eq.s071,ne_code.ilike.s071%,extra->>maker_name.ilike.*しまのや*";

type LoadResult =
  | { ok: true; entries: MallLinkEntry[]; brokenRows: { neCode: string; message: string }[] }
  | { ok: false; message: string };

async function loadEntries(): Promise<LoadResult> {
  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, message: "サーバ設定エラー: SUPABASE_SERVICE_ROLE_KEY が未設定です" };
  }
  const { data, error } = await admin
    .from("products")
    .select("*")
    .or(MAKER_FILTER)
    .order("ne_code", { ascending: true });
  if (error) return { ok: false, message: `商品の取得に失敗しました: ${error.message}` };

  const products = [];
  const brokenRows: { neCode: string; message: string }[] = [];
  for (const row of (data ?? []) as ProductRow[]) {
    try {
      products.push(dbRowToProductInput(row));
    } catch (e) {
      // 検証に落ちる行も「おかしなところ」として一覧に出す（隠さない）
      brokenRows.push({
        neCode: String(row.ne_code ?? row.id),
        message: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }
  return { ok: true, entries: buildMallLinkEntries(products), brokenRows };
}

function ListedBadge({ listed, label }: { listed: boolean; label: string }) {
  return (
    <span
      className={
        "inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold " +
        (listed ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500")
      }
    >
      {label}
      {listed ? "掲載" : "未掲載"}
    </span>
  );
}

export default async function ShimanoyaLinksPage() {
  const result = await loadEntries();

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="text-xl font-bold">しまのや 商品リンク一覧</h1>
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{result.message}</p>
      </main>
    );
  }

  const { entries, brokenRows } = result;
  const problemCount =
    entries.reduce((n, e) => n + e.problems.length, 0) + brokenRows.length;
  const generatedAt = new Date().toISOString();

  // E2E とスプレッドシート貼り付け用の機械可読データ。script 終端誤認を防ぐため < をエスケープ。
  const json = JSON.stringify({ generatedAt, entries, brokenRows }).replaceAll("<", "\\u003c");

  return (
    <div className="min-h-screen w-full bg-slate-50">
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <h1 className="text-xl font-bold">しまのや 商品リンク一覧</h1>
      <p className="mt-1 text-xs text-slate-500">
        全{entries.length}商品 / 書式・データ異常 {problemCount}件 / 生成 {generatedAt}
      </p>

      {problemCount > 0 && (
        <div className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-800">
          書式やデータに異常のある商品があります。各カードの赤字を確認してください。
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {entries.map((e) => (
          <li
            key={e.neCode}
            data-ne-code={e.neCode}
            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{e.neCode}</span>
              <ListedBadge listed={e.rakutenListed} label="楽天" />
              <ListedBadge listed={e.yahooListed} label="Yahoo" />
            </div>
            <div className="mt-1 break-words text-sm text-slate-700">{e.productName}</div>
            <div className="mt-2 flex flex-col gap-1 text-sm">
              {e.rakutenUrl && (
                <a
                  href={e.rakutenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-mall="rakuten"
                  data-listed={e.rakutenListed ? "1" : "0"}
                  className="break-all text-blue-600 underline"
                >
                  楽天: {e.rakutenUrl}
                </a>
              )}
              {e.yahoo.map((y) => (
                <a
                  key={y.itemCode}
                  href={y.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-mall="yahoo"
                  data-listed={e.yahooListed ? "1" : "0"}
                  className="break-all text-purple-700 underline"
                >
                  Yahoo: {y.url}
                </a>
              ))}
            </div>
            {e.problems.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-red-600">
                {e.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {brokenRows.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold text-red-700">データ検証に失敗した商品（要修正）</h2>
          <ul className="mt-2 space-y-1 text-xs text-red-600">
            {brokenRows.map((b) => (
              <li key={b.neCode} className="break-all">
                {b.neCode}: {b.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {entries.length === 0 && brokenRows.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">しまのや（s071）の商品が見つかりません。</p>
      )}

      <script
        id="links-data"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: json }}
      />
    </main>
    </div>
  );
}
