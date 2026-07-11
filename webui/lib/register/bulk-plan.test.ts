import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import type { RakutenCredentials } from "@/lib/rakuten/cabinet-client";
import {
  dryRunRakutenRegister,
  type RakutenRegisterDeps,
} from "./rakuten-register-service";
import {
  toDryRunItemResult,
  toErrorItemResult,
  summarizeBulk,
  buildBulkResponse,
  selectCommitTargets,
} from "./bulk-plan";
import type { BulkItemResult } from "./types";

const cred: RakutenCredentials = { serviceSecret: "sec", licenseKey: "key" };

/** モールAPIを呼ばない注入deps。existingKeys にある管理番号だけ「既存あり」を返す。 */
const fakeDeps = (existingKeys: string[] = []): RakutenRegisterDeps => ({
  getItem: async (_c, manageNumber) => ({
    exists: existingKeys.includes(manageNumber),
    status: existingKeys.includes(manageNumber) ? 200 : 404,
    json: null,
    raw: "",
  }),
  upsertItem: async () => {
    throw new Error("dry-run で upsertItem を呼んではいけない");
  },
  bulkUpsertInventory: async () => {
    throw new Error("dry-run で bulkUpsertInventory を呼んではいけない");
  },
  upsertProduct: async () => {
    throw new Error("dry-run で upsertProduct を呼んではいけない");
  },
});

describe("一括登録 dry-run の件別判定 (F1)", () => {
  it("登録可能(新規)は ok/valid=true・action=create・key を持つ", async () => {
    const p = makeProduct({ maker_code: "a001", jan_code: "4900000001111" });
    const plan = await dryRunRakutenRegister(cred, p, fakeDeps());
    const r = toDryRunItemResult("id-1", p, {
      key: plan.manageNumber,
      exists: plan.exists,
      valid: plan.valid,
      missing: plan.missing,
    });
    expect(r).toMatchObject({
      id: "id-1",
      ne_code: p.ne_code,
      product_name: p.product_name,
      ok: true,
      valid: true,
      willOverwrite: false,
      action: "create",
      key: "a001-1111",
    });
  });

  it("既存あり(上書き予定)は willOverwrite=true・action=update", async () => {
    const p = makeProduct({ maker_code: "b002", jan_code: "4900000002222" });
    const plan = await dryRunRakutenRegister(cred, p, fakeDeps(["b002-2222"]));
    const r = toDryRunItemResult("id-2", p, {
      key: plan.manageNumber,
      exists: plan.exists,
      valid: plan.valid,
      missing: plan.missing,
    });
    expect(r).toMatchObject({ ok: true, valid: true, willOverwrite: true, action: "update" });
  });

  it("必須不足は ok/valid=false・missing 列挙・日本語エラー", async () => {
    const p = makeProduct({ mall_category_id: "", display_name: "" });
    const plan = await dryRunRakutenRegister(cred, p, fakeDeps());
    const r = toDryRunItemResult("id-3", p, {
      key: plan.manageNumber,
      exists: plan.exists,
      valid: plan.valid,
      missing: plan.missing,
    });
    expect(r.ok).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.missing).toContain("genreId(6桁)");
    expect(r.missing).toContain("title");
    expect(r.error).toMatch(/^必須項目が不足: /);
  });

  it("商品未発見は toErrorItemResult で ok/valid=false", () => {
    const r = toErrorItemResult("missing-id", "商品が見つかりません");
    expect(r).toMatchObject({ id: "missing-id", ok: false, valid: false, error: "商品が見つかりません" });
  });
});

describe("一部 invalid でも全体レスポンスは ok (F2) / variants[] 商品を含む (F3)", () => {
  it("valid 2件(うち1件は多SKU)+invalid 1件+上書き1件 → ok:true と正しい集計", async () => {
    const products = [
      { id: "p1", p: makeProduct({ maker_code: "a001", jan_code: "4900000001111" }) },
      // 多SKU(variants[])を持つ商品でも判定・結果生成が壊れない
      {
        id: "p2",
        p: makeProduct({
          maker_code: "c003",
          jan_code: "4900000003333",
          variants: [
            { sku_manage_number: "c003-3333-1", ne_code: "c003-3333-1", jan_code: "4900000003333", selling_price: 1000, tax_rate: 10 as const, quantity: 1 },
            { sku_manage_number: "c003-3333-s01", ne_code: "c003-3333-s01", jan_code: "4900000003340", selling_price: 2500, tax_rate: 10 as const, quantity: 1 },
          ],
        }),
      },
      { id: "p3", p: makeProduct({ mall_category_id: "" }) }, // 必須不足
      { id: "p4", p: makeProduct({ maker_code: "b002", jan_code: "4900000002222" }) }, // 既存あり
    ];
    const deps = fakeDeps(["b002-2222"]);

    const results: BulkItemResult[] = [];
    for (const { id, p } of products) {
      const plan = await dryRunRakutenRegister(cred, p, deps);
      results.push(
        toDryRunItemResult(id, p, {
          key: plan.manageNumber,
          exists: plan.exists,
          valid: plan.valid,
          missing: plan.missing,
        }),
      );
    }
    const res = buildBulkResponse("rakuten", true, results);

    expect(res.ok).toBe(true); // 一部 invalid でも全体は ok
    expect(res.mall).toBe("rakuten");
    expect(res.dryRun).toBe(true);
    expect(res.total).toBe(4);
    expect(res.valid).toBe(3);
    expect(res.invalid).toBe(1);
    expect(res.willOverwrite).toBe(1);
    expect(res.results).toHaveLength(4);

    // 多SKU商品: dry-run body に全SKUが展開されている
    const multi = await dryRunRakutenRegister(cred, products[1].p, deps);
    const variantKeys = Object.keys(multi.body.variants as Record<string, unknown>);
    expect(variantKeys.sort()).toEqual(["c003-3333-1", "c003-3333-s01"]);
    expect(multi.valid).toBe(true);
  });
});

describe("summarizeBulk / selectCommitTargets", () => {
  const results: BulkItemResult[] = [
    { id: "1", ne_code: "n1", product_name: "A", ok: true, valid: true, willOverwrite: false, action: "create" },
    { id: "2", ne_code: "n2", product_name: "B", ok: true, valid: true, willOverwrite: true, action: "update" },
    { id: "3", ne_code: "n3", product_name: "C", ok: false, valid: false, missing: ["genreId(6桁)"], error: "必須項目が不足: genreId(6桁)" },
  ];

  it("commit 結果の succeeded/failed を registered/ok から集計する", () => {
    const commitResults: BulkItemResult[] = [
      { id: "1", ne_code: "n1", product_name: "A", ok: true, valid: true, registered: true },
      { id: "2", ne_code: "n2", product_name: "B", ok: false, valid: true, error: "items.upsert 失敗: IE0001" },
    ];
    expect(summarizeBulk(commitResults)).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
  });

  it("overwrite=false では既存ありの valid 商品を対象から外す（安全側既定）", () => {
    const { targets, skippedOverwrite } = selectCommitTargets(results, false);
    expect(targets.map((r) => r.id)).toEqual(["1"]);
    expect(skippedOverwrite.map((r) => r.id)).toEqual(["2"]);
  });

  it("overwrite=true を明示したときだけ上書き対象を含める", () => {
    const { targets, skippedOverwrite } = selectCommitTargets(results, true);
    expect(targets.map((r) => r.id)).toEqual(["1", "2"]);
    expect(skippedOverwrite).toEqual([]);
  });

  it("invalid はどちらでも対象にならない", () => {
    expect(selectCommitTargets(results, true).targets.some((r) => r.id === "3")).toBe(false);
  });
});

// ---- 以下追記: 「失敗した分だけ再実行」(selectRetryTargets) のテスト ----
// 既存テストは変更しない（import 宣言は ESM 仕様によりホイストされる）。
import { selectRetryTargets } from "./bulk-plan";

describe("selectRetryTargets（失敗した分だけ再実行の対象抽出）", () => {
  const ok = (id: string): BulkItemResult => ({
    id, ne_code: `n-${id}`, product_name: `商品${id}`, ok: true, valid: true, registered: true,
  });
  const ng = (id: string, error: string): BulkItemResult => ({
    id, ne_code: `n-${id}`, product_name: `商品${id}`, ok: false, valid: true, error,
  });

  it("全件成功なら空配列を返す（再実行ボタンを出さない条件）", () => {
    expect(selectRetryTargets([ok("1"), ok("2"), ok("3")])).toEqual([]);
  });

  it("成功と失敗が混在するときは失敗（ok !== true）だけを返す", () => {
    const results = [ok("1"), ng("2", "items.upsert 失敗: IE0001"), ok("3"), ng("4", "通信エラー: fetch failed")];
    const retry = selectRetryTargets(results);
    expect(retry.map((r) => r.id)).toEqual(["2", "4"]);
    // 成功済みの商品は再送対象に含めない
    expect(retry.some((r) => r.ok)).toBe(false);
  });

  it("失敗理由・必須不足などの件別情報を保持したまま返す（再実行と表示にそのまま使える）", () => {
    const missing: BulkItemResult = {
      id: "5", ne_code: "n-5", product_name: "商品5", ok: false, valid: false,
      missing: ["genreId(6桁)"], error: "必須項目が不足: genreId(6桁)",
    };
    const retry = selectRetryTargets([ok("1"), missing]);
    expect(retry).toEqual([missing]);
    expect(retry[0].missing).toContain("genreId(6桁)");
  });

  it("元の並び順を維持する", () => {
    const results = [ng("d", "e1"), ok("x"), ng("b", "e2"), ng("a", "e3")];
    expect(selectRetryTargets(results).map((r) => r.id)).toEqual(["d", "b", "a"]);
  });

  it("全件失敗なら全件返す / 空入力は空を返す", () => {
    expect(selectRetryTargets([ng("1", "e"), ng("2", "e")]).length).toBe(2);
    expect(selectRetryTargets([])).toEqual([]);
  });
});
