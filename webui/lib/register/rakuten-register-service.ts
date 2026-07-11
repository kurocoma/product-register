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
};

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
  opts: { publish?: boolean } = {},
  deps: RakutenRegisterDeps = defaultDeps,
): Promise<RakutenCommitOk | RegisterServiceError> {
  const publish = opts.publish === true;
  const hideItem = !publish;
  const hideStock = !publish;

  const manageNumber = buildRakutenManageNumber(product);
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

  // 在庫数を設定（安全登録は 0）。商品登録成功後に InventoryAPI で別送。
  // 多SKU: 全SKU分を upsert の variant キー(sku_manage_number||ne_code)で送る（在庫variantIdとupsert keyを一致させる）。
  const quantity = 0; // 当面は常に0（在庫連携は別トラック）
  const inv = await deps.bulkUpsertInventory(
    cred,
    productVariants(product).map((v) => ({
      manageNumber,
      variantId: v.sku_manage_number?.trim() || v.ne_code,
      quantity,
    })),
  );

  return {
    ok: true,
    mall: "rakuten",
    manageNumber,
    created: result.created,
    status: result.status,
    safeState: !publish,
    inventorySet: inv.ok,
    inventoryMessage: inv.ok ? `在庫${quantity}` : inv.message,
  };
}
