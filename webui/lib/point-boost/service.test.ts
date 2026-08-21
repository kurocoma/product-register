/** runPointBoost の結合テスト。楽天API（検索・RMS）は fetch スタブ、Supabase はインメモリの
 * フェイクで置き換え、対象抽出→検索→競合判定→PATCH組立→記録 のパイプライン全体を通す。
 * 実クライアント（ichiba-search-client / item-client）を経由するので、URL・ペイロードの
 * 実形もここで検証される。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeProduct } from "@/lib/product/schema";
import { productInputToDbRow } from "@/lib/product/repository";
import { runPointBoost, type PointBoostDeps } from "./service";

const USER_ID = "user-1";
const NOW = new Date("2026-08-17T03:24:30Z"); // JST 12:24:30

type FakeState = {
  settingsRow: Record<string, unknown> | null;
  productRows: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  results: Record<string, unknown>[];
  runUpdates: Record<string, unknown>[];
};

/** repository.ts が使うクエリチェーンだけを実装したインメモリ Supabase。 */
function fakeSupabase(state: FakeState): SupabaseClient {
  return {
    from(table: string) {
      if (table === "point_boost_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.settingsRow, error: null }),
            }),
          }),
        };
      }
      if (table === "point_boost_runs") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const stored = { id: `run-${state.runs.length + 1}`, ...row };
                state.runs.push(stored);
                return { data: { id: stored.id }, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              state.runUpdates.push(patch);
              return { error: null };
            },
          }),
        };
      }
      if (table === "point_boost_results") {
        return {
          insert: async (rows: Record<string, unknown>[]) => {
            state.results.push(...rows);
            return { error: null };
          },
          delete: () => ({
            eq: () => ({
              eq: async () => {
                state.results.length = 0;
                return { error: null };
              },
            }),
          }),
        };
      }
      if (table === "products") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async (from: number, to: number) => ({
                  data: state.productRows.slice(from, to + 1),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`fakeSupabase: 未対応テーブル ${table}`);
    },
  } as unknown as SupabaseClient;
}

/** 楽天掲載済み商品のDB行（products）を作る。 */
function productRow(over: Parameters<typeof makeProduct>[0] = {}): Record<string, unknown> {
  const p = makeProduct({
    ne_code: "ldr-5414-8",
    jan_code: "4573340595414",
    maker_code: "ldr",
    product_name: "ランドリン 柔軟剤 クラシックフローラル 8個セット",
    display_name: "ランドリン 柔軟剤 クラシックフローラル 8個セット",
    selling_price: 4000, // 税抜。税込4400円 → 価格帯ガード 2200〜8800円
    rakuten_manage_number: "ldr-5414",
    mall_listed: { rakuten: true },
    ...over,
  });
  const row = productInputToDbRow(p);
  return { id: "prod-1", user_id: USER_ID, created_at: "", updated_at: "", ...row };
}

/** 検索・RMS の fetch スタブ。PATCH ボディを捕捉する。
 * 検索は2026年刷新後の実APIと同様に accessKey ヘッダが無ければ 400 を返す
 * （accessKey をヘッダで送らない実装バグを全テストで検出する）。 */
function stubRakuten(opts: {
  searchItems: Record<string, unknown>[];
  currentCampaign?: Record<string, unknown>;
}) {
  const patched: { manageNumber: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search")) {
        if (!new Headers(init?.headers).get("accessKey")) {
          return new Response(
            JSON.stringify({ error: "wrong_parameter", error_description: "specify valid accessKey" }),
            { status: 400 },
          );
        }
        return new Response(
          JSON.stringify({ count: opts.searchItems.length, items: opts.searchItems }),
          { status: 200 },
        );
      }
      if (url.includes("api.rms.rakuten.co.jp/es/2.0/items/manage-numbers/")) {
        const manageNumber = decodeURIComponent(url.split("/manage-numbers/")[1]);
        if ((init?.method ?? "GET") === "GET") {
          return new Response(
            JSON.stringify({
              manageNumber,
              ...(opts.currentCampaign ? { pointCampaign: opts.currentCampaign } : {}),
            }),
            { status: 200 },
          );
        }
        if (init?.method === "PATCH") {
          patched.push({ manageNumber, body: JSON.parse(String(init.body)) });
          return new Response(null, { status: 204 }); // 204はボディ不可（undici仕様）
        }
      }
      throw new Error(`stubRakuten: 想定外のリクエスト ${init?.method ?? "GET"} ${url}`);
    }),
  );
  return patched;
}

const searchItem = (over: Record<string, unknown>) => ({
  itemName: "ランドリン 柔軟剤 クラシックフローラル 8個セット 送料無料",
  itemCode: "shop-b:10001",
  itemPrice: 4300,
  pointRate: 1,
  shopCode: "shop-b",
  shopName: "ショップB",
  itemUrl: "https://item.rakuten.co.jp/shop-b/10001/",
  availability: 1,
  ...over,
});

function deps(state: FakeState, over: Partial<PointBoostDeps> = {}): PointBoostDeps {
  return {
    supabase: fakeSupabase(state),
    userId: USER_ID,
    rmsCred: { serviceSecret: "ss", licenseKey: "lk" },
    applicationId: "app-123",
    accessKey: "ak-456",
    sleep: async () => {},
    now: () => NOW,
    ...over,
  };
}

const newState = (over: Partial<FakeState> = {}): FakeState => ({
  settingsRow: null,
  productRows: [productRow()],
  runs: [],
  results: [],
  runUpdates: [],
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runPointBoost 結合", () => {
  it("他店1倍 → 2倍の pointCampaign を実PATCHし、run/results に記録する", async () => {
    const state = newState();
    const patched = stubRakuten({
      searchItems: [
        searchItem({}), // shop-b 4300円 1倍
        searchItem({ shopCode: "shop-c", shopName: "ショップC", itemPrice: 4500 }),
        // 自店の出品は競合から除外される（10倍でも影響しない）
        searchItem({ shopCode: "ichiban-okinawa", itemPrice: 4200, pointRate: 10 }),
        // 価格帯ガード外（単品らしき価格）は無視される
        searchItem({ shopCode: "shop-cheap", itemPrice: 600, pointRate: 10 }),
      ],
    });

    const summary = await runPointBoost(deps(state), { dryRun: false, trigger: "manual" });

    expect(summary.status).toBe("done");
    expect(summary.totals).toMatchObject({ total_targets: 1, boosted_count: 1, error_count: 0 });

    // PATCH の実ペイロード（JST・2倍。now = JST 12:24:30 → earliest 15:00 は昼帯（9〜17時）の途中
    //  → 15:00〜17:00 の残り区間。IE0121/IE0173/IE0154 対策。次の定期実行時点では必ず失効済み）
    expect(patched).toHaveLength(1);
    expect(patched[0].manageNumber).toBe("ldr-5414");
    expect(patched[0].body).toEqual({
      pointCampaign: {
        applicablePeriod: { start: "2026-08-17T15:00:00+09:00", end: "2026-08-17T17:00:00+09:00" },
        benefits: { pointRate: 2 },
      },
    });

    // 記録: run 完了 + 商品別結果
    expect(state.runs).toHaveLength(1);
    expect(state.runUpdates.at(-1)).toMatchObject({ status: "done", boosted_count: 1 });
    expect(state.results).toHaveLength(1);
    expect(state.results[0]).toMatchObject({
      run_id: "run-1",
      ne_code: "ldr-5414-8",
      rakuten_manage_number: "ldr-5414",
      search_keyword: "4573340595414",
      keyword_type: "jan",
      competitor_max_rate: 1,
      current_rate: null,
      target_rate: 2,
      action: "boosted",
    });
    // 競合スナップショットに自店・帯外は入らない
    const comps = state.results[0].competitors as { shopCode: string }[];
    expect(comps.map((c) => c.shopCode).sort()).toEqual(["shop-b", "shop-c"]);
  });

  it("dryRun 既定では PATCH しない（計画だけ記録）", async () => {
    const state = newState();
    const patched = stubRakuten({ searchItems: [searchItem({})] });

    const summary = await runPointBoost(deps(state), { trigger: "manual" }); // dryRun 未指定 = true

    expect(summary.dryRun).toBe(true);
    expect(summary.totals.boosted_count).toBe(1);
    expect(patched).toHaveLength(0); // 反映なし
    expect(state.runs[0]).toMatchObject({ dry_run: true });
  });

  it("scheduled で設定無効なら run を作らず disabled を返す（自動実行の安全弁）", async () => {
    const state = newState();
    stubRakuten({ searchItems: [searchItem({})] });

    const summary = await runPointBoost(deps(state), { dryRun: false, trigger: "scheduled" });

    expect(summary.status).toBe("disabled");
    expect(state.runs).toHaveLength(0);
    expect(state.results).toHaveLength(0);
  });

  it("applicationId 未設定は not_configured の案内を返す（run は作らない）", async () => {
    const state = newState();
    const summary = await runPointBoost(deps(state, { applicationId: null }), {
      dryRun: false,
      trigger: "manual",
    });
    expect(summary.status).toBe("not_configured");
    expect(summary.message).toContain("RAKUTEN_APPLICATION_ID");
    expect(state.runs).toHaveLength(0);
  });

  it("accessKey 未設定も not_configured の案内を返す（2026年刷新後は両方必須）", async () => {
    const state = newState();
    const summary = await runPointBoost(deps(state, { accessKey: null }), {
      dryRun: false,
      trigger: "manual",
    });
    expect(summary.status).toBe("not_configured");
    expect(summary.message).toContain("RAKUTEN_WEBSERVICE_ACCESS_KEY");
    expect(state.runs).toHaveLength(0);
  });

  it("既に高倍率の変倍が適用中なら下げない（降格ガードが実PATCHまで通る）", async () => {
    const state = newState();
    const patched = stubRakuten({
      searchItems: [searchItem({})],
      currentCampaign: {
        applicablePeriod: { start: "2026-08-10T00:00:00+09:00", end: "2026-08-30T00:00:00+09:00" },
        benefits: { pointRate: 5 },
      },
    });

    const summary = await runPointBoost(deps(state), { dryRun: false, trigger: "manual" });

    expect(summary.totals.unchanged_count).toBe(1);
    expect(patched).toHaveLength(0);
    expect(state.results[0]).toMatchObject({ action: "unchanged", current_rate: 5, target_rate: 2 });
  });
});
