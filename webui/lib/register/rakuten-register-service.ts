/** 楽天の商品登録サービス層。
 * app/api/register/rakuten/[id]/route.ts から検証・body生成・upsert送信・登録記録を関数抽出し、
 * 単一登録 route と一括登録 route の両方が同じロジックを使う（重複実装を避ける）。
 * 外部仕様（レスポンス形・安全既定）は単一 route 時代と同一。 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertProduct } from "@/lib/product/repository";
import { productVariants, type ProductInput } from "@/lib/product/schema";
import type { RakutenCredentials } from "@/lib/rakuten/cabinet-client";
import {
  buildRakutenManageNumber,
  buildRakutenUpsertBody,
  validateUpsertBody,
  validateSubscription,
  type RakutenUpsertBody,
} from "@/lib/converters/rakuten-api";
import { upsertItem, getItem } from "@/lib/rakuten/item-client";
import { bulkUpsertInventory } from "@/lib/rakuten/inventory-client";
import type { RegisterServiceError } from "./types";

/** モールAPI呼び出しと保存を注入可能にする（ユニットテストで実送信しないため）。 */
export type RakutenRegisterDeps = {
  getItem: typeof getItem;
  upsertItem: typeof upsertItem;
  bulkUpsertInventory: typeof bulkUpsertInventory;
  upsertProduct: typeof upsertProduct;
};

const defaultDeps: RakutenRegisterDeps = { getItem, upsertItem, bulkUpsertInventory, upsertProduct };

export type RakutenDryRunResult = {
  ok: true;
  dryRun: true;
  mall: "rakuten";
  manageNumber: string;
  exists: boolean;
  willOverwrite: boolean;
  valid: boolean;
  missing: string[];
  body: RakutenUpsertBody;
  /** 在庫送信の予定（260720仕様変更）。quantity=null は「変更しない」（既存商品の未入力SKU）。 */
  inventoryPlan: { variantId: string; quantity: number | null }[];
};

/** 在庫送信の決定（純関数・260720仕様変更）。
 * SKU の stock_quantity 入力済み → その値を送る（0 の明示入力は意図的なゼロ化）。
 * 未入力: 既存商品 → 送らない（在庫を変更しない＝上書き登録で0に潰さない）／新規 → 従来どおり0。 */
export function buildInventoryPlan(
  product: ProductInput,
  exists: boolean,
): { variantId: string; quantity: number }[] {
  return productVariants(product).flatMap((v) => {
    const variantId = v.sku_manage_number?.trim() || v.ne_code;
    if (typeof v.stock_quantity === "number") return [{ variantId, quantity: v.stock_quantity }];
    return exists ? [] : [{ variantId, quantity: 0 }];
  });
}

/** dry-run: 送信予定の upsert body の検証と既存有無の確認（書き込みなし）。 */
export async function dryRunRakutenRegister(
  cred: RakutenCredentials,
  product: ProductInput,
  deps: RakutenRegisterDeps = defaultDeps,
): Promise<RakutenDryRunResult> {
  const manageNumber = buildRakutenManageNumber(product);
  const body = buildRakutenUpsertBody(product);
  const valid = validateUpsertBody(manageNumber, body);
  // 定期購入の事前検証（IE0179/IE0430系）。commit と同じ検証を dry-run でも surface する
  // （定期購入が無効な商品は常に ok = 既存挙動不変）。
  const sub = validateSubscription(product);

  let exists = false;
  try {
    exists = (await deps.getItem(cred, manageNumber)).exists;
  } catch {
    /* プレビューは続行 */
  }

  return {
    ok: true,
    dryRun: true,
    mall: "rakuten",
    manageNumber,
    exists,
    willOverwrite: exists,
    valid: valid.ok && sub.ok,
    missing: [...(valid.ok ? [] : valid.missing), ...(sub.ok ? [] : sub.errors)],
    body,
    inventoryPlan: productVariants(product).map((v) => ({
      variantId: v.sku_manage_number?.trim() || v.ne_code,
      quantity: typeof v.stock_quantity === "number" ? v.stock_quantity : exists ? null : 0,
    })),
  };
}

export type RakutenCommitOk = {
  ok: true;
  mall: "rakuten";
  manageNumber: string;
  created: boolean;
  status: number;
  safeState: boolean;
  inventorySet: boolean;
  inventoryMessage: string;
};

/** commit: items.upsert 実行 + 掲載記録(mall_listed/rakuten_manage_number) + 在庫別送。
 * 安全登録が既定: 倉庫(hideItem)・サーチ在庫非表示(hideStock)・在庫0。
 * publish=true で公開状態にできる（その場合 hideItem/hideStock を解除。在庫は当面常に0）。
 * ⚠ upsert は全置換。多SKU商品は variants[] 全件を展開して送る。 */
export async function commitRakutenRegister(
  supabase: SupabaseClient,
  cred: RakutenCredentials,
  product: ProductInput,
  productId: string,
  opts: { publish?: boolean; keepExistingState?: boolean } = {},
  deps: RakutenRegisterDeps = defaultDeps,
): Promise<RakutenCommitOk | RegisterServiceError> {
  const publish = opts.publish === true;
  const manageNumber = buildRakutenManageNumber(product);

  // 既存商品の現状（存在・倉庫/公開状態）。倉庫の現状維持と在庫スキップ判定に使う（260720仕様変更）。
  let existing: Awaited<ReturnType<RakutenRegisterDeps["getItem"]>> | null = null;
  try {
    existing = await deps.getItem(cred, manageNumber);
  } catch {
    /* 取得失敗時は安全側（下の else = 倉庫）へ */
  }
  const exists = existing?.exists === true;

  let hideItem: boolean;
  let hideStock: boolean;
  if (publish) {
    hideItem = false;
    hideStock = false;
  } else if (opts.keepExistingState && exists && existing?.json) {
    // 現状維持: 楽天の現在の倉庫/サーチ非表示状態を踏襲（公開中の商品を倉庫に落とさない）
    hideItem = existing.json.hideItem === true;
    const feats = existing.json.features as { inventoryDisplay?: unknown } | undefined;
    hideStock = feats?.inventoryDisplay === "HIDDEN_STOCK";
  } else {
    // 従来の安全登録（新規・倉庫指定・現状取得失敗時）
    hideItem = true;
    hideStock = true;
  }

  const body = buildRakutenUpsertBody(product, { hideItem, hideStock });
  const valid = validateUpsertBody(manageNumber, body);
  if (!valid.ok) {
    return { ok: false, kind: "invalid", error: "必須項目が不足: " + valid.missing.join(", "), missing: valid.missing };
  }
  // 定期購入の事前検証（5%割引・フラグ・価格ルール。楽天エラーを送信前に検出）
  const sub = validateSubscription(product);
  if (!sub.ok) {
    return { ok: false, kind: "invalid", error: "定期購入設定が不正: " + sub.errors.join(" / "), missing: sub.errors };
  }

  const result = await deps.upsertItem(cred, manageNumber, body);
  if (!result.ok) {
    return {
      ok: false,
      kind: "api",
      error: "items.upsert 失敗: " + result.message,
      apiStatus: result.status,
      detail: result.body,
    };
  }

  // 楽天に掲載済みを記録（反映ボタン活性用）+ 実管理番号を保存（次回の編集→反映で同一商品へ往復）。
  if (!product.mall_listed?.rakuten || product.rakuten_manage_number !== manageNumber) {
    product.mall_listed = { ...product.mall_listed, rakuten: true };
    product.rakuten_manage_number = manageNumber;
    try {
      await deps.upsertProduct(supabase, product, productId);
    } catch {
      /* 記録失敗は登録自体を妨げない */
    }
  }

  // 在庫の送信（260720仕様変更）: SKU の stock_quantity 入力済み → その値。
  // 未入力: 既存商品 → 送らない（在庫を変更しない）／新規 → 従来どおり0（安全登録）。
  // 多SKU: upsert の variant キー(sku_manage_number||ne_code)で送る（在庫variantIdとupsert keyを一致させる）。
  const plan = buildInventoryPlan(product, exists);
  let inventorySet = true;
  let inventoryMessage = "在庫変更なし（未入力のため送信せず）";
  if (plan.length > 0) {
    const inv = await deps.bulkUpsertInventory(
      cred,
      plan.map((x) => ({ manageNumber, variantId: x.variantId, quantity: x.quantity })),
    );
    inventorySet = inv.ok;
    // 全SKU同一なら従来どおり「在庫N」、SKUごとに異なるときだけ明細（variantId=数量）を列挙
    inventoryMessage = inv.ok
      ? plan.every((x) => x.quantity === plan[0].quantity)
        ? `在庫${plan[0].quantity}`
        : plan.map((x) => `${x.variantId}=${x.quantity}`).join(" / ")
      : inv.message;
  }

  return {
    ok: true,
    mall: "rakuten",
    manageNumber,
    created: result.created,
    status: result.status,
    safeState: hideItem,
    inventorySet,
    inventoryMessage,
  };
}
