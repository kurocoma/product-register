import { describe, expect, it } from "vitest";
import { makeProduct, type ProductInput } from "@/lib/product";
import { yahooTaxInclusive } from "@/lib/converters";
import {
  buildJanPricePlans,
  buildNoticeAppendPlans,
  buildNoticeRemovePlans,
  buildSaleNamePlans,
  executeBulkPlans,
  type BulkDbDeps,
} from "./service";
import type { RakutenClientDeps, YahooClientDeps } from "./mall-push";
import { findNoticeBlocks, wrapNotice } from "./notice";

const JAN_A = "4900000000011";

// ---------------------------------------------------------------------------
// fake deps
// ---------------------------------------------------------------------------

type Entry = { id: string; manage: string; product: ProductInput };

function makeDb(entries: Entry[]) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const saved: { id: string; product: ProductInput }[] = [];
  const history: { productId: string | null; detail: Record<string, unknown> }[] = [];
  const db: BulkDbDeps = {
    findByManage: async (mn) => {
      const e = entries.find((x) => x.manage === mn || byId.get(x.id)!.product.ne_code === mn);
      return e ? { id: e.id, product: byId.get(e.id)!.product } : null;
    },
    findByJan: async (jan) =>
      entries
        .filter((e) => {
          const p = byId.get(e.id)!.product;
          return p.jan_code === jan || (p.variants ?? []).some((v) => v.jan_code === jan);
        })
        .map((e) => ({ id: e.id, product: byId.get(e.id)!.product })),
    saveProduct: async (id, product) => {
      saved.push({ id, product });
      byId.get(id)!.product = product;
    },
    recordHistory: async (productId, detail) => {
      history.push({ productId, detail });
    },
  };
  return { db, saved, history, byId };
}

function makeRakutenFake(
  items: Record<string, Record<string, unknown>>,
  opts: { failPatch?: (mn: string) => boolean } = {},
) {
  const patches: { mn: string; body: Record<string, unknown> }[] = [];
  const client: RakutenClientDeps = {
    getItem: async (mn) =>
      items[mn]
        ? { exists: true, status: 200, json: items[mn] }
        : { exists: false, status: 404, json: null },
    patchItem: async (mn, body) => {
      if (opts.failPatch?.(mn)) return { ok: false, status: 400, message: "IE9999: test failure" };
      patches.push({ mn, body });
      return { ok: true, status: 204 };
    },
  };
  return { client, patches };
}

function makeYahooFake(xmlByCode: Record<string, string>) {
  const edits: Record<string, string>[] = [];
  let reserveCalls = 0;
  const client: YahooClientDeps = {
    sellerId: "test-seller",
    getItem: async (code) =>
      xmlByCode[code] ? { exists: true, raw: xmlByCode[code] } : { exists: false, raw: "" },
    editItem: async (params) => {
      edits.push(params);
      return { ok: true, warnings: [] };
    },
    reservePublish: async () => {
      reserveCalls++;
      return { ok: true, message: "OK" };
    },
  };
  return { client, edits, reserve: () => reserveCalls };
}

/** 楽天 items.get 相当の最小JSON（parseRakutenItem / parseRakutenVariants が読める形）。 */
function rmsJson(
  title: string,
  variants: Record<string, { price: number; jan?: string }>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const vs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variants)) {
    vs[k] = {
      standardPrice: String(v.price),
      merchantDefinedSkuId: k,
      articleNumber: v.jan ? { value: v.jan } : { exemptionReason: 3 },
      shipping: { postageIncluded: true },
    };
  }
  return { title, payment: { taxIncluded: false, taxRate: "0.1" }, variants: vs, ...extra };
}

/** Yahoo getItem 相当の最小XML（parseYahooItem / buildYahooUpdateParams が読める形）。 */
function yahooXml(p: { code: string; name: string; category: string; priceGross: number; path: string }): string {
  return (
    `<ResultSet><Result><Status>OK</Status>` +
    `<ItemCode>${p.code}</ItemCode>` +
    `<Name><![CDATA[${p.name}]]></Name>` +
    `<ProductCategory>${p.category}</ProductCategory>` +
    `<Price>${p.priceGross}</Price>` +
    `<TaxrateType>0.1</TaxrateType>` +
    `<PathList><Path><![CDATA[${p.path}]]></Path></PathList>` +
    `</Result></ResultSet>`
  );
}

const NO_SLEEP = { sleep: async () => {}, };

// ---------------------------------------------------------------------------
// 機能1: JAN売価変更
// ---------------------------------------------------------------------------

describe("buildJanPricePlans — JAN一致抽出（商品/SKU/セット混在）", () => {
  const flat = makeProduct({
    ne_code: "r300-1",
    rakuten_manage_number: "r300",
    jan_code: JAN_A,
    selling_price: 1000,
  });
  const multi = makeProduct({
    ne_code: "r200-1",
    rakuten_manage_number: "r200",
    jan_code: "4900000000097",
    product_type: "セット商品",
    variants: [
      { sku_manage_number: "r200-1", ne_code: "r200-1", jan_code: JAN_A, selling_price: 1000, variation_value: "1本" },
      { sku_manage_number: "r200-2", ne_code: "r200-2", jan_code: JAN_A, selling_price: 1800, variation_value: "2本セット" },
    ],
  });
  const unrelated = makeProduct({ ne_code: "r999-1", jan_code: "4900000000998" });

  it("商品レベル一致（単品）と SKU レベル一致（セット）の両方を抽出する", async () => {
    const { db } = makeDb([
      { id: "id-flat", manage: "r300", product: flat },
      { id: "id-multi", manage: "r200", product: multi },
      { id: "id-x", manage: "r999", product: unrelated },
    ]);
    const { rows, plans, notFoundJans } = await buildJanPricePlans(db, [JAN_A], []);
    expect(new Set(rows.map((r) => r.productId))).toEqual(new Set(["id-flat", "id-multi"]));
    expect(rows).toHaveLength(3); // フラット1行 + SKU2行
    expect(notFoundJans).toEqual([]);
    // 編集なし → 全件 excluded（実行可 0）
    expect(plans.every((p) => p.status === "excluded")).toBe(true);
  });

  it("見つからないJANは notFoundJans に載る", async () => {
    const { db } = makeDb([{ id: "id-flat", manage: "r300", product: flat }]);
    const { notFoundJans } = await buildJanPricePlans(db, ["4999999999999"], []);
    expect(notFoundJans).toEqual(["4999999999999"]);
  });

  it("payloadHash は同一入力・同一DBで安定し、DBの価格が変わると変わる（409 の根拠）", async () => {
    const mk = (price: number) =>
      makeDb([{ id: "id-flat", manage: "r300", product: makeProduct({ ...flatOverrides(), selling_price: price }) }]);
    const edits = [{ productId: "id-flat", variantKey: "", newNet: 1200 }];
    const a1 = await buildJanPricePlans(mk(1000).db, [JAN_A], edits);
    const a2 = await buildJanPricePlans(mk(1000).db, [JAN_A], edits);
    const b = await buildJanPricePlans(mk(900).db, [JAN_A], edits);
    expect(a1.payloadHash).toBe(a2.payloadHash);
    expect(a1.payloadHash).not.toBe(b.payloadHash);
  });

  function flatOverrides() {
    return { ne_code: "r300-1", rakuten_manage_number: "r300", jan_code: JAN_A };
  }
});

describe("executeBulkPlans — JAN売価変更のプレビュー＝実行値一致", () => {
  it("フラット商品: DB保存 → 楽天 patch の standardPrice がプレビューの after と一致する", async () => {
    const flat = makeProduct({
      ne_code: "r300-1",
      rakuten_manage_number: "r300",
      jan_code: JAN_A,
      selling_price: 1000,
      mall_listed: { rakuten: true, yahoo: true },
    });
    const { db, saved } = makeDb([{ id: "id-flat", manage: "r300", product: flat }]);
    const { plans } = await buildJanPricePlans(db, [JAN_A], [
      { productId: "id-flat", variantKey: "", newNet: 1200 },
    ]);
    expect(plans[0].status).toBe("plan");
    const after = plans[0].changes[0].after;
    expect(after).toBe(1200);

    const rk = makeRakutenFake({
      r300: rmsJson(flat.display_name, { "r300-1": { price: 1000, jan: JAN_A } }),
    });
    const yh = makeYahooFake({
      "r300-1": yahooXml({
        code: "r300-1",
        name: flat.display_name,
        category: flat.yahoo_category_id,
        priceGross: yahooTaxInclusive(1000, 10),
        path: flat.yahoo_path,
      }),
    });
    const { results, reserve } = await executeBulkPlans(
      { ...db, rakuten: rk.client, yahoo: yh.client, ...NO_SLEEP },
      plans,
      { kind: "bulk_jan_price", yahooReserve: true, delayMs: 0 },
    );
    expect(results[0].status).toBe("ok");
    // DB: upsert された値がプレビューと同一
    expect(saved[0].product.selling_price).toBe(1200);
    // 楽天: patch の variants.{ne_code}.standardPrice = プレビューの after
    const body = rk.patches[0].body as { variants: Record<string, { standardPrice: string }> };
    expect(body.variants["r300-1"].standardPrice).toBe("1200");
    // Yahoo: editItem の price = プレビュー表示の新Yahoo税込（切り捨て変換）
    expect(yh.edits).toHaveLength(1);
    expect(yh.edits[0].price).toBe(String(yahooTaxInclusive(1200, 10)));
    // 反映予約は Yahoo 更新ありのため 1 回だけ実行される
    expect(reserve).toMatchObject({ requested: true, executed: true, ok: true });
    expect(yh.reserve()).toBe(1);
  });

  it("多SKU商品: 編集したSKUだけ patch / Yahoo は分割擬似商品（該当SKU）だけ editItem", async () => {
    const multi = makeProduct({
      ne_code: "r200-1",
      rakuten_manage_number: "r200",
      mall_listed: { rakuten: true, yahoo: true },
      variants: [
        { sku_manage_number: "r200-1", ne_code: "r200-1", jan_code: JAN_A, selling_price: 1000, shipping_type: "送料無料" },
        { sku_manage_number: "r200-2", ne_code: "r200-2", jan_code: JAN_A, selling_price: 1800, shipping_type: "送料無料" },
      ],
    });
    const { db } = makeDb([{ id: "id-multi", manage: "r200", product: multi }]);
    const { plans } = await buildJanPricePlans(db, [JAN_A], [
      { productId: "id-multi", variantKey: "r200-2", newNet: 1700 },
    ]);
    const rk = makeRakutenFake({
      r200: rmsJson(multi.display_name, {
        "r200-1": { price: 1000, jan: JAN_A },
        "r200-2": { price: 1800, jan: JAN_A },
      }),
    });
    const yh = makeYahooFake({
      "r200-1": yahooXml({ code: "r200-1", name: multi.display_name, category: multi.yahoo_category_id, priceGross: 1100, path: multi.yahoo_path }),
      "r200-2": yahooXml({ code: "r200-2", name: multi.display_name, category: multi.yahoo_category_id, priceGross: 1980, path: multi.yahoo_path }),
    });
    const { results } = await executeBulkPlans(
      { ...db, rakuten: rk.client, yahoo: yh.client, ...NO_SLEEP },
      plans,
      { kind: "bulk_jan_price", yahooReserve: false, delayMs: 0 },
    );
    expect(results[0].status).toBe("ok");
    const body = rk.patches[0].body as { variants: Record<string, { standardPrice: string }> };
    expect(Object.keys(body.variants)).toEqual(["r200-2"]);
    expect(body.variants["r200-2"].standardPrice).toBe("1700");
    // Yahoo: 変更のあった r200-2 だけ editItem（r200-1 は変更なしスキップ）
    expect(yh.edits).toHaveLength(1);
    expect(yh.edits[0].item_code).toBe("r200-2");
    expect(yh.edits[0].price).toBe(String(yahooTaxInclusive(1700, 10)));
  });

  it("失敗継続: 1件目の楽天 patch が失敗しても 2件目は成功する（DBは両方更新済み）", async () => {
    const p1 = makeProduct({ ne_code: "r301-1", rakuten_manage_number: "r301", jan_code: JAN_A, selling_price: 500 });
    const p2 = makeProduct({ ne_code: "r302-1", rakuten_manage_number: "r302", jan_code: JAN_A, selling_price: 700 });
    const { db, saved, history } = makeDb([
      { id: "id1", manage: "r301", product: p1 },
      { id: "id2", manage: "r302", product: p2 },
    ]);
    const { plans } = await buildJanPricePlans(db, [JAN_A], [
      { productId: "id1", variantKey: "", newNet: 550 },
      { productId: "id2", variantKey: "", newNet: 770 },
    ]);
    const rk = makeRakutenFake(
      {
        r301: rmsJson(p1.display_name, { "r301-1": { price: 500, jan: JAN_A } }),
        r302: rmsJson(p2.display_name, { "r302-1": { price: 700, jan: JAN_A } }),
      },
      { failPatch: (mn) => mn === "r301" },
    );
    const { results, reserve } = await executeBulkPlans(
      { ...db, rakuten: rk.client, yahoo: null, ...NO_SLEEP },
      plans,
      { kind: "bulk_jan_price", yahooReserve: false, delayMs: 0 },
    );
    expect(results.map((r) => r.status)).toEqual(["failed", "ok"]);
    expect(results[0].error).toContain("IE9999");
    expect(results[0].error).toContain("アプリDBは更新済み");
    expect(saved).toHaveLength(2);
    expect(history).toHaveLength(2);
    expect(reserve.executed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 機能2: お知らせ一括追記 → 解除（サービス経由の往復）
// ---------------------------------------------------------------------------

describe("buildNoticeAppendPlans / buildNoticeRemovePlans — サービス経由の往復", () => {
  const NOTICE = "<p>【お知らせ】8/11〜8/15は夏季休業です。</p>";
  const base = () =>
    makeProduct({
      ne_code: "r400-1",
      rakuten_manage_number: "r400",
      mall_listed: { rakuten: true },
      sale_description_pc: "販売説明",
      description_pc: "PC説明",
      description_sp: "SP説明",
    });

  it("追記（冒頭・3フィールド）→ patch 本文にマーカー入り説明文が入り、DB保存値=プレビュー after", async () => {
    const { db, saved } = makeDb([{ id: "id4", manage: "r400", product: base() }]);
    const { noticeId, plans } = await buildNoticeAppendPlans(db, ["r400"], {
      body: NOTICE,
      position: "head",
      fields: ["sale_description_pc", "description_pc", "description_sp"],
    });
    expect(plans[0].status).toBe("plan");
    expect(plans[0].includeSalesDescription).toBe(true);
    const { block } = wrapNotice(NOTICE);
    const byField = new Map(plans[0].changes.map((c) => [c.field, c]));
    expect(byField.get("sale_description_pc")?.after).toBe(`${block}\n販売説明`);
    expect(byField.get("description_pc")?.after).toBe(`${block}\nPC説明`);
    expect(byField.get("description_sp")?.after).toBe(`${block}\nSP説明`);

    const rk = makeRakutenFake({
      r400: rmsJson(base().display_name, { "r400-1": { price: 10000, jan: base().jan_code } }, {
        salesDescription: "販売説明",
        productDescription: { pc: "PC説明", sp: "SP説明" },
      }),
    });
    const { results } = await executeBulkPlans(
      { ...db, rakuten: rk.client, yahoo: null, ...NO_SLEEP },
      plans,
      { kind: "bulk_notice_append", yahooReserve: false, delayMs: 0, detail: { notice_id: noticeId } },
    );
    expect(results[0].status).toBe("ok");
    // DB 保存値 = プレビューの after（プレビュー＝実行値一致）
    expect(saved[0].product.sale_description_pc).toBe(byField.get("sale_description_pc")?.after);
    // 楽天 patch: salesDescription / productDescription の両方にマーカーが載る
    const body = rk.patches[0].body as {
      salesDescription: string;
      productDescription: { pc: string; sp: string };
    };
    expect(body.salesDescription).toBe(byField.get("sale_description_pc")?.after);
    expect(body.productDescription.pc).toBe(byField.get("description_pc")?.after);
    expect(body.productDescription.sp).toContain(`<!--PR_NOTICE_START:${noticeId}-->`);
  });

  it("追記済み商品への再追記はスキップ（excluded）・空フィールドは追記しない", async () => {
    const p = base();
    const appended = { ...p, description_pc: `${wrapNotice(NOTICE).block}\nPC説明`, sale_description_pc: "", description_sp: "" };
    const { db } = makeDb([{ id: "id4", manage: "r400", product: appended as ProductInput }]);
    const { plans } = await buildNoticeAppendPlans(db, ["r400"], {
      body: NOTICE,
      position: "head",
      fields: ["sale_description_pc", "description_pc", "description_sp"],
    });
    expect(plans[0].status).toBe("excluded");
    expect(plans[0].warnings.join()).toContain("既に追記済み");
    expect(plans[0].warnings.join()).toContain("空のため追記しません");
  });

  it("末尾追記 → 解除（全選択）で3フィールドとも原文へ完全復元される", async () => {
    const { db, byId } = makeDb([{ id: "id4", manage: "r400", product: base() }]);
    const appendRes = await buildNoticeAppendPlans(db, ["r400"], {
      body: NOTICE,
      position: "tail",
      fields: ["sale_description_pc", "description_pc", "description_sp"],
    });
    await executeBulkPlans({ ...db, rakuten: null, yahoo: null, ...NO_SLEEP }, appendRes.plans, {
      kind: "bulk_notice_append",
      yahooReserve: false,
      delayMs: 0,
    });
    // DB 更新はモール反映の成否に関わらず先に行われる（このテストの主対象は DB 往復）
    const mid = byId.get("id4")!.product;
    expect(findNoticeBlocks(mid.description_pc)).toHaveLength(1);

    const removeRes = await buildNoticeRemovePlans(db, ["r400"], [
      { productId: "id4", field: "sale_description_pc", id: appendRes.noticeId },
      { productId: "id4", field: "description_pc", id: appendRes.noticeId },
      { productId: "id4", field: "description_sp", id: appendRes.noticeId },
    ]);
    expect(removeRes.found).toHaveLength(3);
    expect(removeRes.plans[0].status).toBe("plan");
    await executeBulkPlans({ ...db, rakuten: null, yahoo: null, ...NO_SLEEP }, removeRes.plans, {
      kind: "bulk_notice_remove",
      yahooReserve: false,
      delayMs: 0,
    });
    const finalP = byId.get("id4")!.product;
    expect(finalP.sale_description_pc).toBe("販売説明");
    expect(finalP.description_pc).toBe("PC説明");
    expect(finalP.description_sp).toBe("SP説明");
  });

  it("解除: マーカーが無い商品は excluded / 選択なしは excluded", async () => {
    const { db } = makeDb([{ id: "id4", manage: "r400", product: base() }]);
    const none = await buildNoticeRemovePlans(db, ["r400"], []);
    expect(none.plans[0].status).toBe("excluded");
    expect(none.plans[0].reason).toContain("マーカーが見つかりません");
  });
});

// ---------------------------------------------------------------------------
// 機能3: 商品名セール文言（サービス経由）
// ---------------------------------------------------------------------------

describe("buildSaleNamePlans — 追記/解除とレギュレーション除外", () => {
  const PHRASE = "【スーパーセール10%OFF】";

  it("追記 → 楽天 patch の title / Yahoo editItem の name がプレビューの after と一致する", async () => {
    const p = makeProduct({
      ne_code: "r500-1",
      rakuten_manage_number: "r500",
      display_name: "沖縄そば 5食セット",
      mall_listed: { rakuten: true, yahoo: true },
    });
    const { db, saved } = makeDb([{ id: "id5", manage: "r500", product: p }]);
    const { plans, infos } = await buildSaleNamePlans(db, ["r500"], { phrase: PHRASE, mode: "add" });
    expect(plans[0].status).toBe("plan");
    const after = `${PHRASE} 沖縄そば 5食セット`;
    expect(infos[0].after).toBe(after);

    const rk = makeRakutenFake({
      r500: rmsJson("沖縄そば 5食セット", { "r500-1": { price: 10000, jan: p.jan_code } }),
    });
    const yh = makeYahooFake({
      "r500-1": yahooXml({
        code: "r500-1",
        name: "沖縄そば 5食セット",
        category: p.yahoo_category_id,
        priceGross: yahooTaxInclusive(p.selling_price, 10),
        path: p.yahoo_path,
      }),
    });
    const { results } = await executeBulkPlans(
      { ...db, rakuten: rk.client, yahoo: yh.client, ...NO_SLEEP },
      plans,
      { kind: "bulk_sale_name_add", yahooReserve: false, delayMs: 0 },
    );
    expect(results[0].status).toBe("ok");
    expect(saved[0].product.display_name).toBe(after);
    expect((rk.patches[0].body as { title: string }).title).toBe(after);
    expect(yh.edits[0].name).toBe(after);
  });

  it("追記→解除で商品名が元に戻る（DB 経由の往復）", async () => {
    const p = makeProduct({ ne_code: "r500-1", rakuten_manage_number: "r500", display_name: "沖縄そば 5食セット", mall_listed: {} });
    const { db, byId } = makeDb([{ id: "id5", manage: "r500", product: p }]);
    const addRes = await buildSaleNamePlans(db, ["r500"], { phrase: PHRASE, mode: "add" });
    await executeBulkPlans({ ...db, rakuten: null, yahoo: null, ...NO_SLEEP }, addRes.plans, {
      kind: "bulk_sale_name_add",
      yahooReserve: false,
      delayMs: 0,
    });
    expect(byId.get("id5")!.product.display_name).toBe(`${PHRASE} 沖縄そば 5食セット`);
    const removeRes = await buildSaleNamePlans(db, ["r500"], { phrase: PHRASE, mode: "remove" });
    await executeBulkPlans({ ...db, rakuten: null, yahoo: null, ...NO_SLEEP }, removeRes.plans, {
      kind: "bulk_sale_name_remove",
      yahooReserve: false,
      delayMs: 0,
    });
    expect(byId.get("id5")!.product.display_name).toBe("沖縄そば 5食セット");
  });

  it("Yahoo 75字超過になる商品は excluded で超過量つき（違反はブロック）", async () => {
    // 文言(13字) + スペース(0.5) + 名前70字 = 83.5 > 75
    const p = makeProduct({ ne_code: "r501-1", rakuten_manage_number: "r501", display_name: "あ".repeat(70) });
    const { db } = makeDb([{ id: "id6", manage: "r501", product: p }]);
    const { plans, infos } = await buildSaleNamePlans(db, ["r501"], { phrase: PHRASE, mode: "add" });
    expect(plans[0].status).toBe("excluded");
    expect(plans[0].reason).toContain("超過");
    expect(infos[0].violation?.yahooOverFullWidth).toBeGreaterThan(0);
  });

  it("解除: 先頭に文言が無い商品はスキップ一覧（excluded）", async () => {
    const p = makeProduct({ ne_code: "r502-1", rakuten_manage_number: "r502", display_name: "文言なし商品" });
    const { db } = makeDb([{ id: "id7", manage: "r502", product: p }]);
    const { plans } = await buildSaleNamePlans(db, ["r502"], { phrase: PHRASE, mode: "remove" });
    expect(plans[0].status).toBe("excluded");
    expect(plans[0].reason).toContain("先頭にセール文言がありません");
  });

  it("yahoo_rewrite.name が保存されている商品は同じ操作を適用する", async () => {
    const p = makeProduct({
      ne_code: "r503-1",
      rakuten_manage_number: "r503",
      display_name: "商品名",
      yahoo_rewrite: { name: "Yahoo用短縮名" },
    });
    const { db } = makeDb([{ id: "id8", manage: "r503", product: p }]);
    const { plans } = await buildSaleNamePlans(db, ["r503"], { phrase: PHRASE, mode: "add" });
    expect(plans[0].status).toBe("plan");
    expect(plans[0].mutated?.yahoo_rewrite.name).toBe(`${PHRASE} Yahoo用短縮名`);
  });

  it("アプリDBに無い管理番号は failed（取込を促す）", async () => {
    const { db } = makeDb([]);
    const { plans } = await buildSaleNamePlans(db, ["r999"], { phrase: PHRASE, mode: "add" });
    expect(plans[0].status).toBe("failed");
    expect(plans[0].reason).toContain("見つかりません");
  });
});
