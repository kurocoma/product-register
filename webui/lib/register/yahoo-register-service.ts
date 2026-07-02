/** Yahoo の商品登録サービス層。
 * app/api/register/yahoo/[id]/route.ts から検証・パラメータ生成・editItem送信・反映(submit)を関数抽出し、
 * 単一登録 route と一括登録 route の両方が同じロジックを使う（重複実装を避ける）。
 * 「登録(editItem)」と「反映(reservePublish)」は従来どおり別関数/別フラグで分離する。 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertProduct } from "@/lib/product/repository";
import type { ProductInput } from "@/lib/product/schema";
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
};

/** dry-run: 送信予定の editItem パラメータと既存商品の有無（更新か新規か）を返す（書き込みなし）。 */
export async function dryRunYahooRegister(
  cfg: YahooConfig,
  product: ProductInput,
  deps: YahooRegisterDeps = defaultDeps,
): Promise<YahooDryRunResult> {
  // 既存商品の有無を確認（更新か新規かでマージ方針が変わる）
  let exists = false;
  try {
    const token = await deps.getAccessToken(cfg);
    exists = (await deps.getItem(token, cfg.sellerId, product.ne_code)).exists;
  } catch {
    // 認証失敗時もプレビュー自体は返す（送信予定値の確認が目的）
  }

  const editParams = buildYahooEditItemParams(product, { sellerId: cfg.sellerId, forUpdate: exists });
  const valid = validateEditItemParams(editParams);
  return {
    ok: true,
    dryRun: true,
    mall: "yahoo",
    itemCode: product.ne_code,
    exists,
    willOverwrite: exists,
    valid: valid.ok,
    missing: valid.ok ? [] : valid.missing,
    params: editParams,
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

export type YahooCommitOk = {
  ok: true;
  mall: "yahoo";
  itemCode: string;
  wasUpdate: boolean;
  warnings: string[];
  submitted: boolean;
  submitMessage: string;
};

/** commit: editItem 実行（+ 任意で反映 submit）。
 * - 既存商品があれば forUpdate（display を送らず既存の公開状態を保持する既定動作）。
 * - 安全登録が既定: display=0(非表示)。publish=true で公開(display=1)。
 * - 成功時は mall_listed.yahoo を記録する（一覧の反映ボタン活性用。HTTPレスポンス形は不変）。 */
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
