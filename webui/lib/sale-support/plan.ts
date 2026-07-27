import { calculateRakutenDiscountPrice, paymentTaxRate } from "@/lib/converters";
import type {
  RakutenItemJson,
  RestoreSkuPlan,
  SalePeriod,
  SaleSkuPlan,
} from "./types";

/** 楽天 商品管理番号の上限（32文字）。-SS を付けても収まる必要がある。 */
const RAKUTEN_MANAGE_NUMBER_MAX = 32;
export const SS_SUFFIX = "-SS";

/** 元管理番号 → -SS コピーの管理番号。 */
export function ssManageNumberFor(manageNumber: string): string {
  return `${manageNumber}${SS_SUFFIX}`;
}

/**
 * -SS コピー作成の可否ガード（純関数）。
 * 既に -SS が楽天に存在する商品は対象から外して警告する（上書きしない・確定仕様）。
 */
export function decideSsGuard(
  manageNumber: string,
  ssExists: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (manageNumber.endsWith(SS_SUFFIX)) {
    return { ok: false, reason: "-SS コピー商品そのものはセール適用の対象にできません" };
  }
  if (ssManageNumberFor(manageNumber).length > RAKUTEN_MANAGE_NUMBER_MAX) {
    return {
      ok: false,
      reason: `管理番号が長すぎて -SS コピーを作成できません（${RAKUTEN_MANAGE_NUMBER_MAX - SS_SUFFIX.length}文字以内が対象）`,
    };
  }
  if (ssExists) {
    return {
      ok: false,
      reason: "既に -SS コピーが楽天に存在するため対象外にしました（上書きしません。復元タブで削除してから再実行できます）",
    };
  }
  return { ok: true };
}

/** standardPrice / referencePrice.value を整数円へ（桁区切りカンマ対応）。非数は null。 */
export function parsePriceValue(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function variantsOf(json: RakutenItemJson): Record<string, Record<string, unknown>> {
  const v = json.variants;
  return v && typeof v === "object" ? (v as Record<string, Record<string, unknown>>) : {};
}

/**
 * items.get の生JSONからセール適用の SKU 計算プランを組む。
 *
 * 価格計算は要件定義書v1.0（vault ノート）の正本実装 `calculateRakutenDiscountPrice` を
 * quantity=1 で使う（税込×(1-％)切り捨て → 登録税抜の逆算。再実装しない）。
 * 定期購入価格（subscriptionPrice）は変更しない（確定仕様）。
 */
export function planApplySkus(
  json: RakutenItemJson,
  discountBp: number,
  dualPrice: boolean,
):
  | { ok: true; skus: SaleSkuPlan[]; taxAssumed: boolean }
  | { ok: false; reason: string } {
  const pay = json.payment as { taxIncluded?: unknown } | undefined;
  if (pay?.taxIncluded === true) {
    return {
      ok: false,
      reason: "税込価格で登録された商品のため対象外（価格計算の前提＝税別登録と異なります）",
    };
  }
  const taxFromItem = paymentTaxRate(json);
  const taxPct = taxFromItem ?? 10;
  const variants = variantsOf(json);
  const keys = Object.keys(variants);
  if (keys.length === 0) return { ok: false, reason: "SKU（variants）が取得できません" };

  const skus: SaleSkuPlan[] = [];
  for (const key of keys) {
    const v = variants[key] ?? {};
    const net = parsePriceValue(v.standardPrice);
    if (net == null || net < 1) {
      return { ok: false, reason: `SKU[${key}] の販売価格が取得できないため対象外にしました` };
    }
    const r = calculateRakutenDiscountPrice(net, 1, taxPct, discountBp);
    if (r.afterNet < 1) {
      return { ok: false, reason: `SKU[${key}] の割引後価格が0円になるため対象外にしました` };
    }
    const sub = v.subscriptionPrice as { basePrice?: unknown } | undefined;
    skus.push({
      variantKey: key,
      taxPct,
      beforeNet: net,
      beforeGross: r.beforeGross,
      afterNet: r.afterNet,
      afterGross: r.afterGross,
      targetGross: r.targetGross,
      targetDifference: r.targetDifference,
      referencePriceValue: dualPrice ? net : null,
      hasSubscription: sub?.basePrice != null,
    });
  }
  return { ok: true, skus, taxAssumed: taxFromItem === undefined };
}

/**
 * セール適用の items.patch ボディ（最小ボディ方式。未指定フィールドは RMS が保持する）。
 * - 販売期間: purchasablePeriod {start,end}（実機検証済み書式）
 * - 各SKU: standardPrice（割引後税抜）。二重価格ONは referencePrice に元税抜価格を設定
 *   （REFERENCE_PRICE 形式は既存実装 rakuten-patch.ts と同一）。
 */
export function buildApplyPatchBody(
  skus: SaleSkuPlan[],
  period: SalePeriod,
): Record<string, unknown> {
  const variants: Record<string, unknown> = {};
  for (const s of skus) {
    const vp: Record<string, unknown> = { standardPrice: String(s.afterNet) };
    if (s.referencePriceValue != null) {
      vp.referencePrice = {
        displayType: "REFERENCE_PRICE",
        type: 1,
        value: String(s.referencePriceValue),
      };
    }
    variants[s.variantKey] = vp;
  }
  return { purchasablePeriod: { start: period.start, end: period.end }, variants };
}

/**
 * items.get の生JSONから -SS コピー（倉庫商品）の upsert ボディを作る。
 * メタ項目（manageNumber/created/updated）だけ除き、残り全項目を同一URL参照のまま複製。
 * hideItem: true（倉庫・非公開。既存実装 rakuten-api.ts の安全登録と同じ）。
 * 2026-07-28 実機検証（V4）: この形の upsert が 201 で成立し、価格・倉庫状態が一致する。
 */
export function buildSsCopyBody(raw: RakutenItemJson): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...raw };
  delete copy.manageNumber;
  delete copy.created;
  delete copy.updated;
  copy.hideItem = true;
  return copy;
}

/** 履歴に残す RMS 現在値スナップショット（価格・二重価格・期間・定期の要点。説明文等は -SS コピーが正）。 */
export function snapshotForHistory(json: RakutenItemJson): Record<string, unknown> {
  const variants = variantsOf(json);
  const skus: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(variants)) {
    skus[key] = {
      standardPrice: v.standardPrice ?? null,
      referencePrice: v.referencePrice ?? null,
      subscriptionPrice: v.subscriptionPrice ?? null,
    };
  }
  return {
    title: typeof json.title === "string" ? json.title : "",
    hideItem: json.hideItem === true,
    purchasablePeriod: json.purchasablePeriod ?? null,
    payment: json.payment ?? null,
    variants: skus,
  };
}

/** getItem JSON から purchasablePeriod を読み取る（無ければ null）。 */
export function readPurchasablePeriod(json: RakutenItemJson): SalePeriod | null {
  const pp = json.purchasablePeriod as { start?: unknown; end?: unknown } | null | undefined;
  if (pp && typeof pp === "object" && typeof pp.start === "string" && typeof pp.end === "string") {
    return { start: pp.start, end: pp.end };
  }
  return null;
}

/**
 * 復元プラン: 元商品の価格・二重価格・販売期間を -SS コピーの値へ書き戻す。
 * - referencePrice: -SS の値をそのまま書き戻す。-SS に無ければ null 送信で解除
 *   （2026-07-28 実機検証 V3: null 送信による解除が可能と確認済み）。
 * - purchasablePeriod: -SS の値。無ければ null 送信で解除（実機検証 V2）。
 * - -SS に無い SKU は書き戻せないため警告して残す（部分復元）。
 */
export function planRestoreForItem(
  ssJson: RakutenItemJson,
  originalJson: RakutenItemJson,
):
  | {
      ok: true;
      skus: RestoreSkuPlan[];
      purchasablePeriod: SalePeriod | null;
      periodCleared: boolean;
      warnings: string[];
    }
  | { ok: false; reason: string } {
  const ssVariants = variantsOf(ssJson);
  const origVariants = variantsOf(originalJson);
  const origKeys = Object.keys(origVariants);
  if (origKeys.length === 0) return { ok: false, reason: "元商品の SKU が取得できません" };

  const warnings: string[] = [];
  const skus: RestoreSkuPlan[] = [];
  for (const key of origKeys) {
    const ss = ssVariants[key];
    if (!ss) {
      warnings.push(`SKU[${key}] は -SS コピーに存在しないため書き戻しません`);
      continue;
    }
    const restoreNet = parsePriceValue(ss.standardPrice);
    if (restoreNet == null || restoreNet < 1) {
      warnings.push(`SKU[${key}] の -SS 価格が取得できないため書き戻しません`);
      continue;
    }
    const orig = origVariants[key] ?? {};
    const ssRef =
      ss.referencePrice && typeof ss.referencePrice === "object"
        ? (ss.referencePrice as Record<string, unknown>)
        : null;
    const origRef = orig.referencePrice as { value?: unknown } | null | undefined;
    skus.push({
      variantKey: key,
      currentNet: parsePriceValue(orig.standardPrice),
      restoreNet,
      currentReference: origRef?.value != null ? String(origRef.value) : null,
      restoreReference: ssRef,
      referenceCleared: ssRef == null,
    });
  }
  for (const key of Object.keys(ssVariants)) {
    if (!origVariants[key]) warnings.push(`SKU[${key}] は元商品に存在しません（無視します）`);
  }
  if (skus.length === 0) {
    return { ok: false, reason: "-SS コピーと一致する SKU が無く書き戻せません" };
  }
  const period = readPurchasablePeriod(ssJson);
  return { ok: true, skus, purchasablePeriod: period, periodCleared: period == null, warnings };
}

/** 復元の items.patch ボディ（standardPrice・referencePrice・purchasablePeriod を書き戻し）。 */
export function buildRestorePatchBody(plan: {
  skus: RestoreSkuPlan[];
  purchasablePeriod: SalePeriod | null;
}): Record<string, unknown> {
  const variants: Record<string, unknown> = {};
  for (const s of plan.skus) {
    variants[s.variantKey] = {
      standardPrice: String(s.restoreNet),
      // null は JSON Merge Patch の削除（二重価格の解除）。実機検証 V3 で確認済み。
      referencePrice: s.restoreReference,
    };
  }
  return {
    // null は販売期間の解除（実機検証 V2 で確認済み）。
    purchasablePeriod: plan.purchasablePeriod,
    variants,
  };
}
