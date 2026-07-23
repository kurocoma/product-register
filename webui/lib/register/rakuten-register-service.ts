/** 楽天の商品登録サービス層。
 * app/api/register/rakuten/[id]/route.ts から検証・body生成・upsert送信・登録記録を関数抽出し、
 * 単一登録 route と一括登録 route の両方が同じロジックを使う（重複実装を避ける）。
 * 外部仕様（レスポンス形・安全既定）は単一 route 時代と同一。 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertProduct } from "@/lib/product/repository";
import { productVariants, type ProductInput } from "@/lib/product/schema";
import type { RakutenCredentials } from "@/lib/rakuten/cabinet-client";
import {
  alignSelectorKeyWithExisting,
  alignSelectorsWithExisting,
  buildRakutenManageNumber,
  buildRakutenUpsertBody,
  validateUpsertBody,
  validateSubscription,
  type RakutenUpsertBody,
} from "@/lib/converters/rakuten-api";
import { parseRakutenVariants } from "@/lib/converters/rakuten-item-parser";
import { upsertItem, getItem } from "@/lib/rakuten/item-client";
import { explainRakutenError } from "@/lib/rakuten/error-explainer";
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

const variantKey = (v: ReturnType<typeof productVariants>[number]): string =>
  v.sku_manage_number?.trim() || v.ne_code?.trim() || "";

function unmanagedSpecsErrors(product: ProductInput, reason: string): string[] {
  return productVariants(product)
    .filter((variant) => variant.specs === undefined)
    .map((variant) => `SKU ${variantKey(variant)}: 自由入力行が未管理です。${reason}`);
}

/**
 * 既存商品の全置換upsert前に、旧保存データの specs=undefined を items.get snapshotから補完する。
 * ローカルで [] / 1..5件が明示されているSKUは編集意図として保持し、remoteで上書きしない。
 */
export function prepareRakutenProductForUpsert(
  product: ProductInput,
  existingJson: Record<string, unknown> | null,
): { product: ProductInput; errors: string[] } {
  const localVariants = productVariants(product);
  if (localVariants.every((variant) => variant.specs !== undefined)) {
    return { product, errors: [] };
  }
  if (!existingJson) {
    return {
      product,
      errors: unmanagedSpecsErrors(product, "楽天の現状を取得してから再実行してください"),
    };
  }

  const remoteVariants = parseRakutenVariants(existingJson);
  const bySku = new Map(remoteVariants.map((variant) => [variant.sku_manage_number.trim(), variant]));
  const byNe = new Map(remoteVariants.map((variant) => [variant.ne_code.trim(), variant]));
  const errors: string[] = [];
  const variants = localVariants.map((variant) => {
    if (variant.specs !== undefined) return variant;
    const sku = variant.sku_manage_number.trim();
    const ne = variant.ne_code.trim();
    const remote = (sku ? bySku.get(sku) : undefined) ?? (ne ? byNe.get(ne) : undefined);
    if (!remote) {
      errors.push(`SKU ${variantKey(variant)}: 楽天snapshotに対応SKUがなく自由入力行を補完できません`);
      return variant;
    }
    return { ...variant, specs: remote.specs ?? [] };
  });
  return { product: { ...product, variants }, errors };
}

/** dry-run: 送信予定の upsert body の検証と既存有無の確認（書き込みなし）。 */
export async function dryRunRakutenRegister(
  cred: RakutenCredentials,
  product: ProductInput,
  deps: RakutenRegisterDeps = defaultDeps,
): Promise<RakutenDryRunResult> {
  const manageNumber = buildRakutenManageNumber(product);

  let exists = false;
  let lookupFailed = false;
  let existingJson: Record<string, unknown> | null = null;
  try {
    const existing = await deps.getItem(cred, manageNumber);
    exists = existing.exists;
    existingJson = existing.json;
  } catch {
    lookupFailed = true;
  }
  const prepared = exists
    ? prepareRakutenProductForUpsert(product, existingJson)
    : {
        product,
        errors: lookupFailed
          ? unmanagedSpecsErrors(product, "既存商品の可能性を否定できないため、楽天の現状取得後に再実行してください")
          : [],
      };
  let body = buildRakutenUpsertBody(prepared.product);
  // 既存商品はバリエーション軸キーを楽天の現状に揃える（IE0416 自動補正）。
  // commit の1回目送信（楽観ボディ＝選択肢名はアプリの編集値）と同じ補正を dry-run にも
  // 適用し、プレビュー body と実送信 body を一致させる。
  if (exists && existingJson) body = alignSelectorKeyWithExisting(body, existingJson);
  const valid = validateUpsertBody(manageNumber, body);
  // 定期購入の事前検証（IE0179/IE0430系）。commit と同じ検証を dry-run でも surface する
  // （定期購入が無効な商品は常に ok = 既存挙動不変）。
  const sub = validateSubscription(prepared.product);
  const missing = [...prepared.errors, ...(valid.ok ? [] : valid.missing), ...(sub.ok ? [] : sub.errors)];

  return {
    ok: true,
    dryRun: true,
    mall: "rakuten",
    manageNumber,
    exists,
    willOverwrite: exists,
    valid: missing.length === 0,
    missing,
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
  /** バリエーション選択肢名の変更が楽天に拒否され（IE0416）、現状値のまま登録した場合の案内。 */
  selectorNote?: string;
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
  let lookupFailed = false;
  try {
    existing = await deps.getItem(cred, manageNumber);
  } catch {
    lookupFailed = true;
  }
  const exists = existing?.exists === true;
  const prepared = exists
    ? prepareRakutenProductForUpsert(product, existing?.json ?? null)
    : {
        product,
        errors: lookupFailed
          ? unmanagedSpecsErrors(product, "既存商品の可能性を否定できないため、楽天の現状取得後に再実行してください")
          : [],
      };
  if (prepared.errors.length > 0) {
    return {
      ok: false,
      kind: "invalid",
      error: "自由入力行の完全payloadを作成できません: " + prepared.errors.join(" / "),
      missing: prepared.errors,
    };
  }

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

  let body = buildRakutenUpsertBody(prepared.product, { hideItem, hideStock });
  // 既存商品のバリエーション整合（IE0416 対策・260720実件）: 軸キーは楽天の現状に揃えつつ、
  // 選択肢名はまずアプリの編集値のまま送る（楽観送信。ラベル変更を楽天が受けるならそのまま反映）。
  // 楽天が IE0416 で拒否した場合だけ、現状の選択肢値に揃えたボディで自動再送信する。
  let selectorFallback: RakutenUpsertBody | null = null;
  if (exists && existing?.json) {
    const optimistic = alignSelectorKeyWithExisting(body, existing.json);
    const conservative = alignSelectorsWithExisting(body, existing.json);
    body = optimistic;
    if (JSON.stringify(optimistic) !== JSON.stringify(conservative)) selectorFallback = conservative;
  }
  const valid = validateUpsertBody(manageNumber, body);
  if (!valid.ok) {
    return { ok: false, kind: "invalid", error: "必須項目が不足: " + valid.missing.join(", "), missing: valid.missing };
  }
  // 定期購入の事前検証（5%割引・フラグ・価格ルール。楽天エラーを送信前に検出）
  const sub = validateSubscription(prepared.product);
  if (!sub.ok) {
    return { ok: false, kind: "invalid", error: "定期購入設定が不正: " + sub.errors.join(" / "), missing: sub.errors };
  }

  let result = await deps.upsertItem(cred, manageNumber, body);
  let selectorNote = "";
  if (!result.ok && selectorFallback && /IE0416/.test(result.message)) {
    result = await deps.upsertItem(cred, manageNumber, selectorFallback);
    if (result.ok) {
      selectorNote =
        "バリエーション選択肢名の変更は楽天が拒否したため（IE0416: 既存SKUの選択肢は変更不可）、" +
        "選択肢名は現状のまま他の変更だけ登録しました。選択肢名を変えるには RMS編集ページで変更後、" +
        "「モールから取込」で同期してください";
    }
  }
  if (!result.ok) {
    return {
      ok: false,
      kind: "api",
      error: "items.upsert 失敗: " + result.message + explainRakutenError(result.message),
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
    ...(selectorNote ? { selectorNote } : {}),
  };
}
