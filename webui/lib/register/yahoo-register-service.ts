/** Yahoo の商品登録サービス層。
 * app/api/register/yahoo/[id]/route.ts から検証・パラメータ生成・editItem送信・反映(submit)を関数抽出し、
 * 単一登録 route と一括登録 route の両方が同じロジックを使う（重複実装を避ける）。
 * 「登録(editItem)」と「反映(reservePublish)」は従来どおり別関数/別フラグで分離する。 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertProduct } from "@/lib/product/repository";
import type { ProductInput } from "@/lib/product/schema";
import { yahooItemsForProduct } from "@/lib/product/yahoo-split";
import { getYahooAccessToken, type YahooConfig } from "@/lib/yahoo/auth";
import { buildYahooEditItemParams, validateEditItemParams } from "@/lib/yahoo/item-mapper";
import { editItem, getItem, setStock, reservePublish } from "@/lib/yahoo/item-client";
import type { RegisterServiceError } from "./types";

/** モールAPI呼び出しと保存を注入可能にする（ユニットテストで実送信しないため）。 */
export type YahooRegisterDeps = {
  getAccessToken: typeof getYahooAccessToken;
  getItem: typeof getItem;
  editItem: typeof editItem;
  setStock: typeof setStock;
  reservePublish: typeof reservePublish;
  upsertProduct: typeof upsertProduct;
};

const defaultDeps: YahooRegisterDeps = {
  getAccessToken: getYahooAccessToken,
  getItem,
  editItem,
  setStock,
  reservePublish,
  upsertProduct,
};

/** SKU別の登録計画（統合商品を Yahoo は SKU ごとに分けて登録するため）。 */
export type YahooSkuPlan = {
  itemCode: string;
  exists: boolean;
  valid: boolean;
  missing: string[];
  params: Record<string, string>;
};

export type YahooDryRunResult = {
  ok: true;
  dryRun: true;
  mall: "yahoo";
  itemCode: string;
  exists: boolean;
  willOverwrite: boolean;
  valid: boolean;
  missing: string[];
  params: Record<string, string>;
  /** Yahoo に送る商品数（統合商品は SKU 数。フラット/1SKU 商品は 1）。 */
  skuCount: number;
  /** 統合商品（SKU 2件以上）のときだけ: SKU別の計画。単一商品では undefined（従来形）。 */
  items?: YahooSkuPlan[];
};

/** dry-run: 送信予定の editItem パラメータと既存商品の有無（更新か新規か）を返す（書き込みなし）。
 * 統合商品（variants 2件以上）は yahooItemsForProduct で SKU ごとに分けて判定し、
 * itemCode/params は代表（先頭SKU）、exists/valid は全SKUの集約、SKU別詳細は items[] で返す。 */
export async function dryRunYahooRegister(
  cfg: YahooConfig,
  product: ProductInput,
  deps: YahooRegisterDeps = defaultDeps,
): Promise<YahooDryRunResult> {
  const skuItems = yahooItemsForProduct(product);

  // 認証は一度だけ。失敗時もプレビュー自体は返す（送信予定値の確認が目的。exists=false 扱い）
  let token: string | null = null;
  try {
    token = await deps.getAccessToken(cfg);
  } catch {
    token = null;
  }

  const plans: YahooSkuPlan[] = [];
  for (const item of skuItems) {
    let exists = false;
    if (token) {
      try {
        exists = (await deps.getItem(token, cfg.sellerId, item.ne_code)).exists;
      } catch {
        exists = false;
      }
    }
    const editParams = buildYahooEditItemParams(item, { sellerId: cfg.sellerId, forUpdate: exists });
    const valid = validateEditItemParams(editParams);
    plans.push({
      itemCode: item.ne_code,
      exists,
      valid: valid.ok,
      missing: valid.ok ? [] : valid.missing,
      params: editParams,
    });
  }

  const first = plans[0];
  return {
    ok: true,
    dryRun: true,
    mall: "yahoo",
    itemCode: first.itemCode,
    exists: plans.some((p) => p.exists),
    willOverwrite: plans.some((p) => p.exists),
    valid: plans.every((p) => p.valid),
    missing: [...new Set(plans.flatMap((p) => p.missing))],
    params: first.params,
    skuCount: plans.length,
    ...(plans.length > 1 ? { items: plans } : {}),
  };
}

export type YahooCommitOptions = {
  /** editItem 成功後にストア全体の反映(reservePublish)まで行う。 */
  submit?: boolean;
  /** 公開(display=1)で登録する。既定 false = display=0（非表示）の安全登録。 */
  publish?: boolean;
  /** 公開(display=1)時に設定する在庫数（>0 のときのみ setStock）。 */
  stockQuantity?: number;
  /** テスト用に display を明示指定（publish より優先）。 */
  forceDisplay?: string;
};

/** SKU別の commit 結果（統合商品を SKU ごとに editItem した場合）。 */
export type YahooSkuCommitResult = {
  itemCode: string;
  ok: boolean;
  wasUpdate: boolean;
  warnings: string[];
  /** 失敗理由（ユーザー向け日本語）。ok=true では undefined。 */
  error?: string;
};

export type YahooCommitOk = {
  ok: true;
  mall: "yahoo";
  itemCode: string;
  wasUpdate: boolean;
  warnings: string[];
  submitted: boolean;
  submitMessage: string;
  /** 統合商品（SKU 2件以上）のときだけ: SKU別の成否。単一商品では undefined（従来形）。 */
  skuResults?: YahooSkuCommitResult[];
  /** 統合商品のときだけ: 集計と表示用メッセージ（例「4SKU中4件登録」）。 */
  skuSummary?: { total: number; succeeded: number; failed: number; message: string };
};

/** commit: editItem 実行（+ 任意で反映 submit）。
 * - 既存商品があれば forUpdate（display を送らず既存の公開状態を保持する既定動作）。
 * - 安全登録が既定: display=0(非表示)。publish=true で公開(display=1)。
 * - 成功時は mall_listed.yahoo を記録する（一覧の反映ボタン活性用。HTTPレスポンス形は不変）。
 * - 統合商品（variants 2件以上）は SKU ごとに editItem を逐次実行する（Yahooは商品を分ける）。
 *   1件の失敗で残りSKUを止めず、skuResults/skuSummary に成否を集約する。
 *   1件以上成功すれば ok:true（掲載記録は元の統合商品を productId へ1回だけ保存。
 *   SKU擬似商品でDBを上書きしない）。全SKU失敗なら api エラーを返す。 */
export async function commitYahooRegister(
  supabase: SupabaseClient,
  cfg: YahooConfig,
  product: ProductInput,
  productId: string,
  opts: YahooCommitOptions = {},
  deps: YahooRegisterDeps = defaultDeps,
): Promise<YahooCommitOk | RegisterServiceError> {
  const doSubmit = opts.submit === true;
  const publish = opts.publish === true;
  const stockQuantity =
    typeof opts.stockQuantity === "number" && opts.stockQuantity >= 0 ? Math.floor(opts.stockQuantity) : 0;
  const forceDisplay: string | undefined =
    typeof opts.forceDisplay === "string" ? opts.forceDisplay : publish ? undefined : "0";

  let token: string;
  try {
    token = await deps.getAccessToken(cfg);
  } catch (e) {
    return {
      ok: false,
      kind: "auth",
      error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証）",
    };
  }

  const skuItems = yahooItemsForProduct(product);

  // --- フラット/1SKU 商品: 従来どおりの単一 editItem（挙動不変） ---
  if (skuItems.length === 1) {
    const exists = (await deps.getItem(token, cfg.sellerId, product.ne_code)).exists;
    const editParams = buildYahooEditItemParams(product, { sellerId: cfg.sellerId, forUpdate: exists, forceDisplay });
    const valid = validateEditItemParams(editParams);
    if (!valid.ok) {
      return { ok: false, kind: "invalid", error: "必須項目が不足: " + valid.missing.join(", "), missing: valid.missing };
    }

    const result = await deps.editItem(token, editParams);
    if (!result.ok) {
      return {
        ok: false,
        kind: "api",
        error: "editItem 失敗: " + result.message,
        errors: result.errors,
        warnings: result.warnings,
      };
    }

    // Yahoo に掲載済みを記録（一覧の反映ボタン活性用）。記録失敗は登録自体を妨げない。
    if (!product.mall_listed?.yahoo) {
      product.mall_listed = { ...product.mall_listed, yahoo: true };
      try {
        await deps.upsertProduct(supabase, product, productId);
      } catch {
        /* 記録失敗は登録自体を妨げない */
      }
    }

    let submitted = false;
    let submitMessage = "";
    if (doSubmit) {
      // 公開(display=1)かつ在庫指定があれば在庫設定（購入可能化）。
      let stockNote = "";
      if (publish && stockQuantity > 0) {
        const st = await deps.setStock(token, cfg.sellerId, product.ne_code, stockQuantity);
        if (!st.ok) stockNote = `在庫設定失敗: ${st.message} / `;
      }
      // フロント反映は reservePublish（全反映予約）。submitItem は存在しない誤APIのため使わない。
      // 反映はストア全体単位（商品単位指定は不可）。
      const s = await deps.reservePublish(token, cfg.sellerId);
      submitted = s.ok;
      submitMessage = stockNote + s.message;
    }

    return {
      ok: true,
      mall: "yahoo",
      itemCode: product.ne_code,
      wasUpdate: exists,
      warnings: result.warnings,
      submitted,
      submitMessage,
    };
  }

  // --- 統合商品（SKU 2件以上）: SKU ごとに editItem を逐次実行（1件の失敗で止めない） ---
  const skuResults: YahooSkuCommitResult[] = [];
  for (const item of skuItems) {
    try {
      const exists = (await deps.getItem(token, cfg.sellerId, item.ne_code)).exists;
      const editParams = buildYahooEditItemParams(item, { sellerId: cfg.sellerId, forUpdate: exists, forceDisplay });
      const valid = validateEditItemParams(editParams);
      if (!valid.ok) {
        skuResults.push({
          itemCode: item.ne_code,
          ok: false,
          wasUpdate: exists,
          warnings: [],
          error: "必須項目が不足: " + valid.missing.join(", "),
        });
        continue;
      }
      const result = await deps.editItem(token, editParams);
      if (!result.ok) {
        skuResults.push({
          itemCode: item.ne_code,
          ok: false,
          wasUpdate: exists,
          warnings: result.warnings,
          error: "editItem 失敗: " + result.message,
        });
        continue;
      }
      skuResults.push({ itemCode: item.ne_code, ok: true, wasUpdate: exists, warnings: result.warnings });
    } catch (e) {
      skuResults.push({
        itemCode: item.ne_code,
        ok: false,
        wasUpdate: false,
        warnings: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const succeeded = skuResults.filter((r) => r.ok);
  const failed = skuResults.filter((r) => !r.ok);
  const failNote = failed.map((f) => `${f.itemCode}: ${f.error ?? "失敗"}`).join(" / ");

  if (succeeded.length === 0) {
    return {
      ok: false,
      kind: "api",
      error: `editItem 失敗（${skuResults.length}SKU中0件登録）: ${failNote}`,
      errors: failed.map((f) => `${f.itemCode}: ${f.error ?? "失敗"}`),
      warnings: [...new Set(skuResults.flatMap((r) => r.warnings))],
    };
  }

  // 掲載記録は「元の統合商品」を productId へ1回だけ保存する（SKU擬似商品でDBを上書きしない）。
  if (!product.mall_listed?.yahoo) {
    product.mall_listed = { ...product.mall_listed, yahoo: true };
    try {
      await deps.upsertProduct(supabase, product, productId);
    } catch {
      /* 記録失敗は登録自体を妨げない */
    }
  }

  let submitted = false;
  let submitMessage = "";
  if (doSubmit) {
    let stockNote = "";
    if (publish && stockQuantity > 0) {
      // 在庫は登録に成功した SKU ごとに設定する
      for (const s of succeeded) {
        const st = await deps.setStock(token, cfg.sellerId, s.itemCode, stockQuantity);
        if (!st.ok) stockNote += `在庫設定失敗(${s.itemCode}): ${st.message} / `;
      }
    }
    // 反映はストア全体単位のため1回だけ予約する
    const s = await deps.reservePublish(token, cfg.sellerId);
    submitted = s.ok;
    submitMessage = stockNote + s.message;
  }

  const message =
    failed.length === 0
      ? `${skuResults.length}SKU中${succeeded.length}件登録`
      : `${skuResults.length}SKU中${succeeded.length}件登録・${failed.length}件失敗（${failNote}）`;

  return {
    ok: true,
    mall: "yahoo",
    itemCode: product.ne_code,
    wasUpdate: succeeded.some((r) => r.wasUpdate),
    warnings: [...new Set(skuResults.flatMap((r) => r.warnings))],
    submitted,
    submitMessage,
    skuResults,
    skuSummary: { total: skuResults.length, succeeded: succeeded.length, failed: failed.length, message },
  };
}

/** ストア全体の反映予約（reservePublish）だけを行う。
 * 一括登録では商品ごとに予約せず、全件処理後に1回だけ呼ぶ（反映はストア全体単位のため）。 */
export async function reserveYahooPublish(
  cfg: YahooConfig,
  deps: YahooRegisterDeps = defaultDeps,
): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await deps.getAccessToken(cfg);
    const s = await deps.reservePublish(token, cfg.sellerId);
    return { ok: s.ok, message: s.message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
