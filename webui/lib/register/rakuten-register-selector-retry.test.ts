/** commitRakutenRegister の選択肢名・楽観送信＋IE0416 フォールバックのテスト（260720）。
 * 1回目はアプリの編集ラベルのまま送信し、楽天が IE0416 で拒否したときだけ
 * 現状の選択肢値に揃えたボディで自動再送信し、selectorNote で案内する。 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeProduct } from "../product/schema";
import { commitRakutenRegister, type RakutenRegisterDeps } from "./rakuten-register-service";

const CRED = { serviceSecret: "s", licenseKey: "l" } as never;
const SB = {} as SupabaseClient;

const twoSkus = [
  { sku_manage_number: "r122-1", ne_code: "r122-1", jan_code: "4589837520975", selling_price: 3565, tax_rate: 8 as const, quantity: 1, shipping_type: "送料無料", variation_value: "1袋" },
  { sku_manage_number: "r122-3", ne_code: "r122-3", jan_code: "4589837520975", selling_price: 10160, tax_rate: 8 as const, quantity: 1, shipping_type: "送料無料", variation_value: "3袋" },
];

const existingJson = {
  variantSelectors: [{ key: "type", displayName: "タイプ", values: [{ displayValue: "1本" }, { displayValue: "1本(2)" }] }],
  variants: {
    "r122-1": { selectorValues: { type: "1本" } },
    "r122-3": { selectorValues: { type: "1本(2)" } },
  },
};

/** upsertItem の応答列を指定できるフェイク deps。送信ボディを全部記録する。 */
function fakeDeps(upsertResults: { ok: boolean; message?: string }[]) {
  const bodies: Record<string, unknown>[] = [];
  let call = 0;
  const deps: RakutenRegisterDeps = {
    getItem: async () => ({ exists: true, status: 200, json: existingJson, raw: "" }),
    upsertItem: (async (_c: unknown, _m: unknown, body: unknown) => {
      bodies.push(body as Record<string, unknown>);
      const r = upsertResults[Math.min(call++, upsertResults.length - 1)];
      return r.ok
        ? { ok: true, created: false, status: 204 }
        : { ok: false, status: 400, message: r.message ?? "エラー", body: "" };
    }) as never,
    bulkUpsertInventory: (async () => ({ ok: true, message: "" })) as never,
    upsertProduct: (async () => ({})) as never,
  };
  return { deps, bodies };
}

const labelsOf = (body: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(body.variants as Record<string, { selectorValues?: Record<string, string> }>).map(
      ([id, v]) => [id, v.selectorValues?.type],
    ),
  );

const product = () => makeProduct({ variants: twoSkus, rakuten_manage_number: "r122-1" });

describe("commitRakutenRegister: 選択肢名の楽観送信＋IE0416フォールバック", () => {
  it("楽天がラベル変更を受理 → 1回で成功し、編集ラベルが送られる", async () => {
    const { deps, bodies } = fakeDeps([{ ok: true }]);
    const r = await commitRakutenRegister(SB, CRED, product(), "id-1", { keepExistingState: true }, deps);
    expect(r.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(labelsOf(bodies[0])).toEqual({ "r122-1": "1袋", "r122-3": "3袋" });
    if (r.ok) expect(r.selectorNote).toBeUndefined();
  });

  it("IE0416 で拒否 → 現状の選択肢値で自動再送信し selectorNote を返す", async () => {
    const { deps, bodies } = fakeDeps([
      { ok: false, message: "IE0416: Cannot update selectorValues for the same variantId." },
      { ok: true },
    ]);
    const r = await commitRakutenRegister(SB, CRED, product(), "id-1", { keepExistingState: true }, deps);
    expect(r.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(labelsOf(bodies[0])).toEqual({ "r122-1": "1袋", "r122-3": "3袋" });
    expect(labelsOf(bodies[1])).toEqual({ "r122-1": "1本", "r122-3": "1本(2)" });
    if (r.ok) expect(r.selectorNote).toContain("IE0416");
  });

  it("IE0416 以外の失敗は再送信せずエラーを返す", async () => {
    const { deps, bodies } = fakeDeps([{ ok: false, message: "IE0215: Cannot set strong" }]);
    const r = await commitRakutenRegister(SB, CRED, product(), "id-1", { keepExistingState: true }, deps);
    expect(r.ok).toBe(false);
    expect(bodies).toHaveLength(1);
  });

  it("ラベルが既存と一致している場合はフォールバック不要（1回で成功・注記なし）", async () => {
    const same = makeProduct({
      rakuten_manage_number: "r122-1",
      variants: twoSkus.map((v, i) => ({ ...v, variation_value: ["1本", "1本(2)"][i] })),
    });
    const { deps, bodies } = fakeDeps([{ ok: true }]);
    const r = await commitRakutenRegister(SB, CRED, same, "id-1", { keepExistingState: true }, deps);
    expect(r.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    if (r.ok) expect(r.selectorNote).toBeUndefined();
  });
});
