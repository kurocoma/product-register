import {
  buildApplyPatchBody,
  buildRestorePatchBody,
  buildSsCopyBody,
  decideSsGuard,
  parsePriceValue,
  planApplySkus,
  planRestoreForItem,
  readPurchasablePeriod,
  snapshotForHistory,
  SS_SUFFIX,
  ssManageNumberFor,
} from "./plan";
import { hashSaleSupportPlan } from "./hash";
import type {
  ApplyItemPlan,
  RakutenItemJson,
  RestoreItemPlan,
  SalePeriod,
  SaleSupportItemResult,
} from "./types";

export type RmsGetResult = { exists: boolean; status: number; json: RakutenItemJson | null };
export type RmsWriteResult = { ok: boolean; status: number; message?: string };

/** per-item 実行に必要な副作用。route が実クライアント（タイムアウト付き）を注入し、テストは fake を注入する。 */
export type SaleSupportDeps = {
  getItem: (manageNumber: string) => Promise<RmsGetResult>;
  upsertItem: (manageNumber: string, body: Record<string, unknown>) => Promise<RmsWriteResult>;
  patchItem: (manageNumber: string, body: Record<string, unknown>) => Promise<RmsWriteResult>;
  deleteItem: (manageNumber: string) => Promise<RmsWriteResult>;
  /** -SS コピーをアプリDBへ保存（失敗しても実行は続行し警告で明示） */
  saveSsCopy: (ssManageNumber: string, raw: RakutenItemJson) => Promise<{ ok: boolean; error?: string }>;
  /** 管理番号からアプリ商品IDを引く（履歴の product_id 用。無ければ null） */
  findProductId: (manageNumber: string) => Promise<string | null>;
  /** -SS のアプリDB行を削除（復元の「削除する」用） */
  deleteSsRow: (ssManageNumber: string) => Promise<{ ok: boolean; error?: string }>;
  recordHistory: (productId: string | null, detail: Record<string, unknown>) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

export type ApplyOptions = {
  discountBp: number;
  period: SalePeriod;
  dualPrice: boolean;
  /** item 間の待機ms（レート制御。既定300） */
  delayMs?: number;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** items.get の「見つからない(404)」と「取得失敗(429/5xx等)」を区別する。
 * 429 をペーサー再試行後も引いた場合などに、存在しない扱いで誤進行しないため。 */
function getFailureReason(label: string, got: RmsGetResult): string {
  return got.status === 404
    ? `楽天に${label}が見つかりません`
    : `${label}の取得（items.get）が HTTP ${got.status} を返しました。時間をおいて再実行してください`;
}

async function pause(deps: SaleSupportDeps, index: number, delayMs: number): Promise<void> {
  if (index > 0 && delayMs > 0) await (deps.sleep ?? defaultSleep)(delayMs);
}

/**
 * セール適用のプレビュー（read-before-write）。書き込みは行わない。
 * commit も同じ関数で組み直し、payloadHash の一致で「プレビューで表示した値と
 * 同一のものだけを実行」を担保する（不一致は 409 で再プレビュー）。
 */
export async function buildApplyPlans(
  deps: SaleSupportDeps,
  manageNumbers: string[],
  opts: ApplyOptions,
): Promise<{ plans: ApplyItemPlan[]; payloadHash: string }> {
  const delayMs = opts.delayMs ?? 300;
  const plans: ApplyItemPlan[] = [];
  for (let i = 0; i < manageNumbers.length; i++) {
    await pause(deps, i, delayMs);
    const manageNumber = manageNumbers[i];
    const ssManageNumber = ssManageNumberFor(manageNumber);
    try {
      // 管理番号の形（-SS 自身・32文字超）は取得前に純関数ガードで弾く
      const preGuard = decideSsGuard(manageNumber, false);
      if (!preGuard.ok) {
        plans.push({ manageNumber, ssManageNumber, status: "excluded", reason: preGuard.reason });
        continue;
      }
      const got = await deps.getItem(manageNumber);
      if (!got.exists || !got.json) {
        plans.push({
          manageNumber,
          ssManageNumber,
          status: "failed",
          reason: getFailureReason(`管理番号「${manageNumber}」の商品`, got),
        });
        continue;
      }
      const title = typeof got.json.title === "string" ? got.json.title : "";
      const ssGot = await deps.getItem(ssManageNumber);
      if (!ssGot.exists && ssGot.status !== 404) {
        // -SS の存在確認が失敗（429等）のまま「無い」と誤断すると既存コピーを上書きしうる
        plans.push({
          manageNumber,
          ssManageNumber,
          status: "failed",
          reason: getFailureReason(`-SS コピー「${ssManageNumber}」の存在確認`, ssGot),
          title,
        });
        continue;
      }
      const guard = decideSsGuard(manageNumber, ssGot.exists);
      if (!guard.ok) {
        plans.push({ manageNumber, ssManageNumber, status: "excluded", reason: guard.reason, title });
        continue;
      }
      const planned = planApplySkus(got.json, opts.discountBp, opts.dualPrice);
      if (!planned.ok) {
        plans.push({ manageNumber, ssManageNumber, status: "excluded", reason: planned.reason, title });
        continue;
      }
      plans.push({
        manageNumber,
        ssManageNumber,
        status: "plan",
        title,
        taxAssumed: planned.taxAssumed,
        skus: planned.skus,
        patchBody: buildApplyPatchBody(planned.skus, opts.period),
        raw: got.json,
      });
    } catch (e) {
      plans.push({ manageNumber, ssManageNumber, status: "failed", reason: errMessage(e) });
    }
  }
  const payloadHash = hashSaleSupportPlan({
    kind: "apply",
    discountBp: opts.discountBp,
    period: opts.period,
    dualPrice: opts.dualPrice,
    items: plans
      .filter((p) => p.status === "plan")
      .map((p) => ({
        manageNumber: p.manageNumber,
        ssManageNumber: p.ssManageNumber,
        patchBody: p.patchBody,
      })),
  });
  return { plans, payloadHash };
}

/** 適用後の読み戻し検証（プレビュー値どおりに RMS へ入ったか）。 */
export function verifyApplyReadback(
  json: RakutenItemJson | null,
  plan: ApplyItemPlan,
): { ok: true } | { ok: false; reason: string } {
  if (!json) return { ok: false, reason: "読み戻し（items.get）に失敗しました" };
  const period = (plan.patchBody?.purchasablePeriod ?? null) as SalePeriod | null;
  const back = readPurchasablePeriod(json);
  if (period && (back?.start !== period.start || back?.end !== period.end)) {
    return { ok: false, reason: `販売期間が一致しません（実際: ${JSON.stringify(back)}）` };
  }
  const variants = (json.variants ?? {}) as Record<string, Record<string, unknown>>;
  for (const s of plan.skus ?? []) {
    const v = variants[s.variantKey];
    const net = v ? parsePriceValue(v.standardPrice) : null;
    if (net !== s.afterNet) {
      return { ok: false, reason: `SKU[${s.variantKey}] の価格が一致しません（期待 ${s.afterNet} / 実際 ${net ?? "取得不可"}）` };
    }
    if (s.referencePriceValue != null) {
      const ref = v?.referencePrice as { value?: unknown } | undefined;
      if (parsePriceValue(ref?.value) !== s.referencePriceValue) {
        return { ok: false, reason: `SKU[${s.variantKey}] の二重価格が一致しません` };
      }
    }
  }
  return { ok: true };
}

/**
 * セール適用の実行。順序は安全側に固定:
 * (1) -SS コピー作成（元価格の控え）→ 失敗なら元商品に触れない
 * (2) アプリDBへ -SS 行保存（失敗は警告で続行。RMS 上のコピーが正）
 * (3) 元商品へ最小 patch（価格・二重価格・販売期間）
 * (4) 読み戻し検証 → (5) 履歴記録（スナップショット込み）
 */
export async function executeApply(
  deps: SaleSupportDeps,
  plans: ApplyItemPlan[],
  opts: ApplyOptions,
): Promise<SaleSupportItemResult[]> {
  const delayMs = opts.delayMs ?? 300;
  const results: SaleSupportItemResult[] = [];
  for (let i = 0; i < plans.length; i++) {
    await pause(deps, i, delayMs);
    const plan = plans[i];
    const base = { manageNumber: plan.manageNumber, ssManageNumber: plan.ssManageNumber };
    if (plan.status !== "plan" || !plan.raw || !plan.patchBody) {
      results.push({ ...base, status: plan.status, error: plan.reason, warnings: [] });
      continue;
    }
    const warnings: string[] = [];
    let productId: string | null = null;
    try {
      productId = await deps.findProductId(plan.manageNumber);
    } catch {
      productId = null;
    }
    const snapshot = snapshotForHistory(plan.raw);
    const detail: Record<string, unknown> = {
      kind: "sale_support_apply",
      manage_number: plan.manageNumber,
      ss_manage_number: plan.ssManageNumber,
      discount_bp: opts.discountBp,
      period: opts.period,
      dual_price: opts.dualPrice,
      snapshot,
      patch_body: plan.patchBody,
    };
    let result: SaleSupportItemResult;
    try {
      const copyRes = await deps.upsertItem(plan.ssManageNumber, buildSsCopyBody(plan.raw));
      if (!copyRes.ok) {
        result = {
          ...base,
          status: "failed",
          error: `-SS コピーの作成に失敗: ${copyRes.message ?? `HTTP ${copyRes.status}`}（元商品は変更していません）`,
          warnings,
        };
      } else {
        try {
          const dbRes = await deps.saveSsCopy(plan.ssManageNumber, plan.raw);
          if (!dbRes.ok) {
            warnings.push(`アプリDBへの -SS 行保存に失敗（復元一覧に表示されません）: ${dbRes.error ?? "不明"}`);
          }
        } catch (e) {
          warnings.push(`アプリDBへの -SS 行保存に失敗（復元一覧に表示されません）: ${errMessage(e)}`);
        }
        const patchRes = await deps.patchItem(plan.manageNumber, plan.patchBody);
        if (!patchRes.ok) {
          result = {
            ...base,
            status: "failed",
            error: `楽天への反映に失敗: ${patchRes.message ?? `HTTP ${patchRes.status}`}（-SS コピーは作成済み・元商品の価格は変わっていません。再実行は復元タブで -SS を削除してから）`,
            warnings,
          };
        } else {
          const back = await deps.getItem(plan.manageNumber);
          const verify = back.json
            ? verifyApplyReadback(back.json, plan)
            : ({ ok: false, reason: `読み戻し（items.get）が HTTP ${back.status} を返しました` } as const);
          result = verify.ok
            ? { ...base, status: "ok", warnings, verified: true }
            : {
                ...base,
                status: "failed",
                error: `反映後の読み戻し確認で不一致: ${verify.reason}。楽天RMSで現物を確認してください`,
                warnings,
                verified: false,
              };
        }
      }
    } catch (e) {
      result = { ...base, status: "failed", error: errMessage(e), warnings };
    }
    try {
      await deps.recordHistory(productId, {
        ...detail,
        result_status: result.status,
        result_error: result.error ?? null,
        warnings: result.warnings,
      });
    } catch {
      result.warnings.push("履歴の記録に失敗しました");
    }
    results.push(result);
  }
  return results;
}

/** 復元のプレビュー。apply と同じく commit 側で再構築し payloadHash を突き合わせる。 */
export async function buildRestorePlans(
  deps: SaleSupportDeps,
  ssManageNumbers: string[],
  opts: { delayMs?: number } = {},
): Promise<{ plans: RestoreItemPlan[]; payloadHash: string }> {
  const delayMs = opts.delayMs ?? 300;
  const plans: RestoreItemPlan[] = [];
  for (let i = 0; i < ssManageNumbers.length; i++) {
    await pause(deps, i, delayMs);
    const ssManageNumber = ssManageNumbers[i];
    const originalManageNumber = ssManageNumber.endsWith(SS_SUFFIX)
      ? ssManageNumber.slice(0, -SS_SUFFIX.length)
      : "";
    const base = { ssManageNumber, originalManageNumber, warnings: [] as string[] };
    try {
      if (!originalManageNumber) {
        plans.push({ ...base, status: "failed", reason: "復元対象は -SS コピーの管理番号のみです" });
        continue;
      }
      const ssGot = await deps.getItem(ssManageNumber);
      if (!ssGot.exists || !ssGot.json) {
        plans.push({ ...base, status: "failed", reason: getFailureReason(`-SS コピー「${ssManageNumber}」`, ssGot) });
        continue;
      }
      const origGot = await deps.getItem(originalManageNumber);
      if (!origGot.exists || !origGot.json) {
        plans.push({ ...base, status: "failed", reason: getFailureReason(`元商品「${originalManageNumber}」`, origGot) });
        continue;
      }
      const planned = planRestoreForItem(ssGot.json, origGot.json);
      if (!planned.ok) {
        plans.push({ ...base, status: "failed", reason: planned.reason });
        continue;
      }
      plans.push({
        ...base,
        status: "plan",
        title: typeof origGot.json.title === "string" ? origGot.json.title : "",
        skus: planned.skus,
        purchasablePeriod: planned.purchasablePeriod,
        periodCleared: planned.periodCleared,
        warnings: planned.warnings,
        patchBody: buildRestorePatchBody(planned),
        rawOriginal: origGot.json,
      });
    } catch (e) {
      plans.push({ ...base, status: "failed", reason: errMessage(e) });
    }
  }
  const payloadHash = hashSaleSupportPlan({
    kind: "restore",
    items: plans
      .filter((p) => p.status === "plan")
      .map((p) => ({
        ssManageNumber: p.ssManageNumber,
        originalManageNumber: p.originalManageNumber,
        patchBody: p.patchBody,
      })),
  });
  return { plans, payloadHash };
}

/** 復元後の読み戻し検証。 */
export function verifyRestoreReadback(
  json: RakutenItemJson | null,
  plan: RestoreItemPlan,
): { ok: true } | { ok: false; reason: string } {
  if (!json) return { ok: false, reason: "読み戻し（items.get）に失敗しました" };
  const back = readPurchasablePeriod(json);
  const expected = plan.purchasablePeriod ?? null;
  if (expected == null && back != null) {
    return { ok: false, reason: "販売期間が解除されていません" };
  }
  if (expected != null && (back?.start !== expected.start || back?.end !== expected.end)) {
    return { ok: false, reason: `販売期間が一致しません（実際: ${JSON.stringify(back)}）` };
  }
  const variants = (json.variants ?? {}) as Record<string, Record<string, unknown>>;
  for (const s of plan.skus ?? []) {
    const v = variants[s.variantKey];
    const net = v ? parsePriceValue(v.standardPrice) : null;
    if (net !== s.restoreNet) {
      return { ok: false, reason: `SKU[${s.variantKey}] の価格が一致しません（期待 ${s.restoreNet} / 実際 ${net ?? "取得不可"}）` };
    }
    const ref = v?.referencePrice as { value?: unknown } | null | undefined;
    if (s.referenceCleared) {
      if (ref != null) return { ok: false, reason: `SKU[${s.variantKey}] の二重価格が解除されていません` };
    } else if (s.restoreReference != null) {
      if (parsePriceValue(ref?.value) !== parsePriceValue(s.restoreReference.value)) {
        return { ok: false, reason: `SKU[${s.variantKey}] の二重価格が一致しません` };
      }
    }
  }
  return { ok: true };
}

/**
 * 復元の実行: 元商品へ書き戻し → 読み戻し検証 → 成功時のみ選択に応じて -SS を削除。
 * 書き戻しに失敗・不一致の場合は -SS を残す（復元の手掛かりを消さない）。
 */
export async function executeRestore(
  deps: SaleSupportDeps,
  plans: RestoreItemPlan[],
  opts: { deleteCopy: boolean; delayMs?: number },
): Promise<SaleSupportItemResult[]> {
  const delayMs = opts.delayMs ?? 300;
  const results: SaleSupportItemResult[] = [];
  for (let i = 0; i < plans.length; i++) {
    await pause(deps, i, delayMs);
    const plan = plans[i];
    const base = { manageNumber: plan.originalManageNumber, ssManageNumber: plan.ssManageNumber };
    if (plan.status !== "plan" || !plan.rawOriginal || !plan.patchBody) {
      results.push({ ...base, status: plan.status, error: plan.reason, warnings: plan.warnings });
      continue;
    }
    const warnings = [...plan.warnings];
    let productId: string | null = null;
    try {
      productId = await deps.findProductId(plan.originalManageNumber);
    } catch {
      productId = null;
    }
    const detail: Record<string, unknown> = {
      kind: "sale_support_restore",
      manage_number: plan.originalManageNumber,
      ss_manage_number: plan.ssManageNumber,
      delete_copy: opts.deleteCopy,
      snapshot: snapshotForHistory(plan.rawOriginal),
      patch_body: plan.patchBody,
    };
    let result: SaleSupportItemResult;
    try {
      const patchRes = await deps.patchItem(plan.originalManageNumber, plan.patchBody);
      if (!patchRes.ok) {
        result = {
          ...base,
          status: "failed",
          error: `楽天への書き戻しに失敗: ${patchRes.message ?? `HTTP ${patchRes.status}`}（-SS コピーは残しています）`,
          warnings,
        };
      } else {
        const back = await deps.getItem(plan.originalManageNumber);
        const verify = back.json
          ? verifyRestoreReadback(back.json, plan)
          : ({ ok: false, reason: `読み戻し（items.get）が HTTP ${back.status} を返しました` } as const);
        if (!verify.ok) {
          result = {
            ...base,
            status: "failed",
            error: `復元後の読み戻し確認で不一致: ${verify.reason}。-SS コピーは残しています`,
            warnings,
            verified: false,
          };
        } else {
          if (opts.deleteCopy) {
            const delRes = await deps.deleteItem(plan.ssManageNumber);
            if (!delRes.ok) {
              warnings.push(`-SS コピーの削除に失敗しました（楽天に残っています）: ${delRes.message ?? `HTTP ${delRes.status}`}`);
            } else {
              try {
                const rowRes = await deps.deleteSsRow(plan.ssManageNumber);
                if (!rowRes.ok) warnings.push(`アプリDBの -SS 行の削除に失敗しました: ${rowRes.error ?? "不明"}`);
              } catch (e) {
                warnings.push(`アプリDBの -SS 行の削除に失敗しました: ${errMessage(e)}`);
              }
            }
          }
          result = { ...base, status: "ok", warnings, verified: true };
        }
      }
    } catch (e) {
      result = { ...base, status: "failed", error: errMessage(e), warnings };
    }
    try {
      await deps.recordHistory(productId, {
        ...detail,
        result_status: result.status,
        result_error: result.error ?? null,
        warnings: result.warnings,
      });
    } catch {
      result.warnings.push("履歴の記録に失敗しました");
    }
    results.push(result);
  }
  return results;
}
