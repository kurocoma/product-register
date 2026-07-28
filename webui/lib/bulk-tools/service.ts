import type { ProductInput } from "@/lib/product";
import { mallPresence } from "@/lib/product";
import { hashSaleSupportPlan } from "@/lib/sale-support";
import {
  applyJanPriceEdits,
  buildJanPriceRows,
  janPriceRowKeyOf,
  type JanPriceEdit,
  type JanPriceRow,
} from "./jan-price";
import {
  appendNotice,
  findNoticeBlocks,
  hasNoticeBlock,
  NOTICE_FIELD_LABELS,
  removeNoticeBlock,
  wrapNotice,
  type NoticeField,
  type NoticePosition,
} from "./notice";
import {
  addSalePrefix,
  checkSaleNameLimits,
  describeSaleNameViolation,
  removeSalePrefix,
  type SaleNameCheck,
} from "./sale-name";
import {
  pushProductToRakuten,
  pushProductToYahoo,
  type RakutenClientDeps,
  type YahooClientDeps,
} from "./mall-push";
import type {
  BulkExecItemResult,
  BulkFieldChange,
  BulkPlanItem,
  MallPushOutcome,
  ReserveOutcome,
} from "./types";

/** 一括ツールのサービス層（sale-support の service.ts と同じ deps 注入方式）。
 *
 * フロー: 対象選択 → プレビュー（dry-run・書き込みなし）→ payloadHash 承認 →
 * DB更新（upsertProduct 経由）→ モール反映（楽天 patch / Yahoo editItem）→ 履歴記録。
 * commit もプレビューと同じ関数でプランを組み直し、payloadHash の一致で
 * 「プレビューで表示した値と同一のものだけを実行」を担保する（不一致は 409 で再プレビュー）。
 * 失敗した商品はスキップして続行する（失敗継続）。
 */

export type BulkDbDeps = {
  /** 管理番号（extra->>rakuten_manage_number 優先 → NEコード）でアプリDBの商品を引く。 */
  findByManage: (manageNumber: string) => Promise<{ id: string; product: ProductInput } | null>;
  /** JAN 一致（products.jan_code / variants[].jan_code）で商品を列挙する。 */
  findByJan: (jan: string) => Promise<{ id: string; product: ProductInput }[]>;
  /** upsertProduct 経由の保存（zod 検証・履歴付き）。 */
  saveProduct: (id: string, product: ProductInput) => Promise<void>;
  recordHistory: (productId: string | null, detail: Record<string, unknown>) => Promise<void>;
};

export type BulkToolsDeps = BulkDbDeps & {
  rakuten: RakutenClientDeps | null;
  yahoo: YahooClientDeps | null;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function displayKeyOf(product: ProductInput): string {
  return product.rakuten_manage_number?.trim() || product.ne_code;
}

/** hash 対象のプラン要約（実行内容と before 値を含む決定的なキー順の配列）。 */
function hashableItems(plans: BulkPlanItem[]): unknown[] {
  return plans
    .filter((p) => p.status === "plan")
    .map((p) => ({ productId: p.productId, key: p.key, changes: p.changes }));
}

// ---------------------------------------------------------------------------
// 機能1: JAN売価変更
// ---------------------------------------------------------------------------

export type JanPricePlanResult = {
  rows: JanPriceRow[];
  plans: BulkPlanItem[];
  payloadHash: string;
  /** 一致する商品が見つからなかった JAN */
  notFoundJans: string[];
};

export async function buildJanPricePlans(
  deps: BulkDbDeps,
  jans: string[],
  edits: JanPriceEdit[],
): Promise<JanPricePlanResult> {
  const janSet = new Set(jans);
  const products = new Map<string, { id: string; product: ProductInput }>();
  const notFoundJans: string[] = [];
  for (const jan of jans) {
    const found = await deps.findByJan(jan);
    if (found.length === 0) notFoundJans.push(jan);
    for (const f of found) products.set(f.id, f);
  }
  const editMap = new Map<string, number>();
  for (const e of edits) editMap.set(janPriceRowKeyOf(e.productId, e.variantKey), e.newNet);

  const rows: JanPriceRow[] = [];
  const plans: BulkPlanItem[] = [];
  for (const { id, product } of products.values()) {
    const key = displayKeyOf(product);
    rows.push(...buildJanPriceRows(id, key, product, janSet, editMap));
    const { mutated, changes, errors } = applyJanPriceEdits(id, product, edits);
    const base = {
      key,
      productId: id,
      title: product.display_name || product.product_name,
      warnings: [] as string[],
    };
    if (errors.length > 0) {
      plans.push({ ...base, status: "failed", reason: errors.join(" / "), changes: [] });
      continue;
    }
    if (changes.length === 0) {
      plans.push({ ...base, status: "excluded", reason: "新価格が未入力（スキップ）", changes: [] });
      continue;
    }
    plans.push({ ...base, status: "plan", changes, mutated });
  }
  const payloadHash = hashSaleSupportPlan({ kind: "jan-price", items: hashableItems(plans) });
  return { rows, plans, payloadHash, notFoundJans };
}

// ---------------------------------------------------------------------------
// 機能2: お知らせ一括追記（説明文）・解除
// ---------------------------------------------------------------------------

export type NoticeAppendOptions = {
  body: string;
  position: NoticePosition;
  fields: NoticeField[];
};

export type NoticeAppendPlanResult = {
  noticeId: string;
  plans: BulkPlanItem[];
  payloadHash: string;
  notFound: string[];
};

export async function buildNoticeAppendPlans(
  deps: BulkDbDeps,
  manageNumbers: string[],
  opts: NoticeAppendOptions,
): Promise<NoticeAppendPlanResult> {
  const { id: noticeId, block } = wrapNotice(opts.body);
  const plans: BulkPlanItem[] = [];
  const notFound: string[] = [];
  for (const mn of manageNumbers) {
    let found: { id: string; product: ProductInput } | null = null;
    try {
      found = await deps.findByManage(mn);
    } catch (e) {
      plans.push({ key: mn, productId: "", status: "failed", reason: errMessage(e), changes: [], warnings: [] });
      continue;
    }
    if (!found) {
      notFound.push(mn);
      plans.push({
        key: mn,
        productId: "",
        status: "failed",
        reason: "アプリDBに商品が見つかりません（先にモール取込してください）",
        changes: [],
        warnings: [],
      });
      continue;
    }
    const { id, product } = found;
    const warnings: string[] = [];
    const changes: BulkFieldChange[] = [];
    const mutated: ProductInput = { ...product };
    for (const field of opts.fields) {
      const label = NOTICE_FIELD_LABELS[field];
      const cur = String(product[field] ?? "");
      if (!cur.trim()) {
        warnings.push(`${label}: 空のため追記しません（空欄は自動生成などの既存運用を保持）`);
        continue;
      }
      if (hasNoticeBlock(cur, noticeId)) {
        warnings.push(`${label}: 同じお知らせが既に追記済みです`);
        continue;
      }
      const after = appendNotice(cur, block, opts.position);
      changes.push({ field, before: cur, after });
      mutated[field] = after;
    }
    const base = { key: displayKeyOf(product), productId: id, title: product.display_name, warnings };
    if (changes.length === 0) {
      plans.push({ ...base, status: "excluded", reason: "追記できる説明文がありません（警告参照）", changes: [] });
      continue;
    }
    plans.push({
      ...base,
      status: "plan",
      changes,
      mutated,
      includeSalesDescription: changes.some((c) => c.field === "sale_description_pc"),
    });
  }
  const payloadHash = hashSaleSupportPlan({
    kind: "notice-append",
    noticeId,
    position: opts.position,
    fields: opts.fields,
    items: hashableItems(plans),
  });
  return { noticeId, plans, payloadHash, notFound };
}

/** 解除対象の選択（商品×フィールド×マーカーID）。 */
export type NoticeBlockRef = { productId: string; field: NoticeField; id: string };

export type NoticeFoundBlock = {
  productId: string;
  key: string;
  title: string;
  field: NoticeField;
  fieldLabel: string;
  id: string;
  body: string;
  selected: boolean;
};

export type NoticeRemovePlanResult = {
  found: NoticeFoundBlock[];
  plans: BulkPlanItem[];
  payloadHash: string;
};

export async function buildNoticeRemovePlans(
  deps: BulkDbDeps,
  manageNumbers: string[],
  selection: NoticeBlockRef[],
): Promise<NoticeRemovePlanResult> {
  const selected = new Set(selection.map((s) => `${s.productId}|${s.field}|${s.id}`));
  const found: NoticeFoundBlock[] = [];
  const plans: BulkPlanItem[] = [];
  const FIELDS = Object.keys(NOTICE_FIELD_LABELS) as NoticeField[];
  for (const mn of manageNumbers) {
    let hit: { id: string; product: ProductInput } | null = null;
    try {
      hit = await deps.findByManage(mn);
    } catch (e) {
      plans.push({ key: mn, productId: "", status: "failed", reason: errMessage(e), changes: [], warnings: [] });
      continue;
    }
    if (!hit) {
      plans.push({
        key: mn,
        productId: "",
        status: "failed",
        reason: "アプリDBに商品が見つかりません（先にモール取込してください）",
        changes: [],
        warnings: [],
      });
      continue;
    }
    const { id, product } = hit;
    const key = displayKeyOf(product);
    const changes: BulkFieldChange[] = [];
    const mutated: ProductInput = { ...product };
    let blockCount = 0;
    for (const field of FIELDS) {
      const cur = String(product[field] ?? "");
      const blocks = findNoticeBlocks(cur);
      blockCount += blocks.length;
      const idsToRemove = new Set<string>();
      for (const b of blocks) {
        const isSelected = selected.has(`${id}|${field}|${b.id}`);
        found.push({
          productId: id,
          key,
          title: product.display_name,
          field,
          fieldLabel: NOTICE_FIELD_LABELS[field],
          id: b.id,
          body: b.body,
          selected: isSelected,
        });
        if (isSelected) idsToRemove.add(b.id);
      }
      if (idsToRemove.size > 0) {
        let after = cur;
        for (const bid of idsToRemove) after = removeNoticeBlock(after, bid);
        changes.push({ field, before: cur, after });
        mutated[field] = after;
      }
    }
    const base = { key, productId: id, title: product.display_name, warnings: [] as string[] };
    if (blockCount === 0) {
      plans.push({ ...base, status: "excluded", reason: "お知らせマーカーが見つかりません", changes: [] });
      continue;
    }
    if (changes.length === 0) {
      plans.push({ ...base, status: "excluded", reason: "削除対象が未選択です", changes: [] });
      continue;
    }
    plans.push({
      ...base,
      status: "plan",
      changes,
      mutated,
      includeSalesDescription: changes.some((c) => c.field === "sale_description_pc"),
    });
  }
  const payloadHash = hashSaleSupportPlan({ kind: "notice-remove", items: hashableItems(plans) });
  return { found, plans, payloadHash };
}

// ---------------------------------------------------------------------------
// 機能3: 商品名セール文言
// ---------------------------------------------------------------------------

export type SaleNameMode = "add" | "remove";

/** プレビュー表示用の per-item 追加情報（BulkPlanItem.changes と併せて返す）。 */
export type SaleNameItemInfo = {
  key: string;
  before: string;
  after?: string;
  /** 追記モードで上限超過のときの計測値（警告一覧に「何字オーバーか」を表示） */
  violation?: SaleNameCheck;
};

export type SaleNamePlanResult = {
  plans: BulkPlanItem[];
  infos: SaleNameItemInfo[];
  payloadHash: string;
};

export async function buildSaleNamePlans(
  deps: BulkDbDeps,
  manageNumbers: string[],
  opts: { phrase: string; mode: SaleNameMode },
): Promise<SaleNamePlanResult> {
  const plans: BulkPlanItem[] = [];
  const infos: SaleNameItemInfo[] = [];
  for (const mn of manageNumbers) {
    let hit: { id: string; product: ProductInput } | null = null;
    try {
      hit = await deps.findByManage(mn);
    } catch (e) {
      plans.push({ key: mn, productId: "", status: "failed", reason: errMessage(e), changes: [], warnings: [] });
      continue;
    }
    if (!hit) {
      plans.push({
        key: mn,
        productId: "",
        status: "failed",
        reason: "アプリDBに商品が見つかりません（先にモール取込してください）",
        changes: [],
        warnings: [],
      });
      continue;
    }
    const { id, product } = hit;
    const key = displayKeyOf(product);
    const name = product.display_name;
    const base = { key, productId: id, title: name, warnings: [] as string[] };
    const applied = opts.mode === "add" ? addSalePrefix(name, opts.phrase) : removeSalePrefix(name, opts.phrase);
    if (!applied.ok) {
      plans.push({ ...base, status: "excluded", reason: applied.reason, changes: [] });
      infos.push({ key, before: name });
      continue;
    }
    if (opts.mode === "add") {
      const check = checkSaleNameLimits(applied.after);
      if (!check.ok) {
        plans.push({
          ...base,
          status: "excluded",
          reason: `文字数レギュレーション違反のため除外: ${describeSaleNameViolation(check)}`,
          changes: [],
        });
        infos.push({ key, before: name, after: applied.after, violation: check });
        continue;
      }
    }
    const changes: BulkFieldChange[] = [{ field: "display_name", before: name, after: applied.after }];
    const mutated: ProductInput = { ...product, display_name: applied.after };
    // Yahoo 向け手動リライト名（yahoo_rewrite.name）が保存されている商品は、migrate 再実行時の
    // 整合のため同じ操作を適用する（追記できない/外せない場合は警告のみ・実行は継続）。
    const rewriteName = product.yahoo_rewrite?.name ?? "";
    if (rewriteName) {
      const r = opts.mode === "add" ? addSalePrefix(rewriteName, opts.phrase) : removeSalePrefix(rewriteName, opts.phrase);
      if (r.ok) {
        changes.push({ field: "yahoo_rewrite.name", before: rewriteName, after: r.after });
        mutated.yahoo_rewrite = { ...product.yahoo_rewrite, name: r.after };
        if (opts.mode === "add") {
          const rc = checkSaleNameLimits(r.after);
          if (!rc.ok) {
            base.warnings.push(
              `Yahoo手動リライト名が上限超過になります（${describeSaleNameViolation(rc)}）。次回の一括移行前に短縮してください`,
            );
          }
        }
      } else {
        base.warnings.push(`Yahoo手動リライト名（yahoo_rewrite.name）: ${r.reason}`);
      }
    }
    plans.push({ ...base, status: "plan", changes, mutated });
    infos.push({ key, before: name, after: applied.after });
  }
  const payloadHash = hashSaleSupportPlan({
    kind: "sale-name",
    mode: opts.mode,
    phrase: opts.phrase,
    items: hashableItems(plans),
  });
  return { plans, infos, payloadHash };
}

// ---------------------------------------------------------------------------
// 実行（3機能共通）: DB更新 → 楽天 patch → Yahoo editItem → 履歴。失敗継続。
// ---------------------------------------------------------------------------

export type BulkExecuteOptions = {
  /** 履歴 detail の kind（例 "bulk_jan_price"） */
  kind: string;
  /** 実行後に Yahoo 反映予約（reservePublish mode=1）を行うか（実行時チェックボックス） */
  yahooReserve: boolean;
  /** item 間の待機ms（既定300。RMS/Yahoo クライアント側のペーシングと併用） */
  delayMs?: number;
  /** 履歴 detail に足す機能別情報（notice_id 等） */
  detail?: Record<string, unknown>;
};

/** 履歴用に長文フィールドを長さ要約へ落とす（説明文の全文を history に積まない）。 */
function changesForHistory(changes: BulkFieldChange[]): unknown[] {
  const isLong = (v: unknown) => typeof v === "string" && v.length > 300;
  return changes.map((c) =>
    isLong(c.before) || isLong(c.after)
      ? {
          field: c.field,
          variantKey: c.variantKey,
          before_length: String(c.before ?? "").length,
          after_length: String(c.after ?? "").length,
        }
      : c,
  );
}

export async function executeBulkPlans(
  deps: BulkToolsDeps,
  plans: BulkPlanItem[],
  opts: BulkExecuteOptions,
): Promise<{ results: BulkExecItemResult[]; reserve: ReserveOutcome }> {
  const delayMs = opts.delayMs ?? 300;
  const sleep = deps.sleep ?? defaultSleep;
  const results: BulkExecItemResult[] = [];
  for (let i = 0; i < plans.length; i++) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const plan = plans[i];
    const base = { key: plan.key, productId: plan.productId, warnings: [...plan.warnings] };
    if (plan.status !== "plan" || !plan.mutated) {
      results.push({ ...base, status: plan.status, error: plan.reason });
      continue;
    }
    let result: BulkExecItemResult;
    try {
      await deps.saveProduct(plan.productId, plan.mutated);
    } catch (e) {
      result = {
        ...base,
        status: "failed",
        error: `アプリDBの保存に失敗: ${errMessage(e)}（モールへは送信していません）`,
      };
      results.push(result);
      await recordItemHistory(deps, plan, result, opts);
      continue;
    }
    const presence = mallPresence(plan.mutated);
    const rakuten: MallPushOutcome = presence.rakuten
      ? deps.rakuten
        ? await pushProductToRakuten(deps.rakuten, plan.mutated, {
            includeSalesDescription: plan.includeSalesDescription,
          })
        : { attempted: false, ok: false, updated: 0, skipped: [], message: "楽天 ESA 認証情報が未設定です" }
      : { attempted: false, ok: true, updated: 0, skipped: [], message: "楽天未掲載（送信なし）" };
    const yahoo: MallPushOutcome = presence.yahoo
      ? deps.yahoo
        ? await pushProductToYahoo(deps.yahoo, plan.mutated)
        : { attempted: false, ok: false, updated: 0, skipped: [], message: "Yahoo 認証情報が未設定です" }
      : { attempted: false, ok: true, updated: 0, skipped: [], message: "Yahoo未掲載（送信なし）" };
    const errs: string[] = [];
    if (!rakuten.ok) errs.push(`楽天: ${rakuten.message}`);
    if (!yahoo.ok) errs.push(`Yahoo: ${yahoo.message}`);
    result = {
      ...base,
      status: errs.length > 0 ? "failed" : "ok",
      error:
        errs.length > 0
          ? `${errs.join(" / ")}（アプリDBは更新済み。モールへの再送は商品編集画面の「反映」を使ってください）`
          : undefined,
      warnings: [
        ...base.warnings,
        ...rakuten.skipped.map((s) => `楽天で未反映: ${s}`),
        ...yahoo.skipped.map((s) => `Yahooで未反映: ${s}`),
      ],
      rakuten,
      yahoo,
    };
    results.push(result);
    await recordItemHistory(deps, plan, result, opts);
  }

  // Yahoo 反映予約（ストア全体で1回。編集が実際に送られた場合のみ）。
  const requested = opts.yahooReserve;
  let reserve: ReserveOutcome;
  const yahooUpdated = results.some((r) => (r.yahoo?.updated ?? 0) > 0);
  if (!requested) {
    reserve = { requested: false, executed: false, ok: true, message: "反映予約は実行しない設定です" };
  } else if (!yahooUpdated) {
    reserve = {
      requested: true,
      executed: false,
      ok: true,
      message: "Yahoo への更新が無かったため反映予約は実行しませんでした",
    };
  } else if (!deps.yahoo) {
    reserve = { requested: true, executed: false, ok: false, message: "Yahoo 認証情報が未設定のため反映予約できません" };
  } else {
    try {
      const r = await deps.yahoo.reservePublish();
      reserve = { requested: true, executed: true, ok: r.ok, message: r.message };
    } catch (e) {
      reserve = { requested: true, executed: true, ok: false, message: errMessage(e) };
    }
  }
  return { results, reserve };
}

async function recordItemHistory(
  deps: BulkToolsDeps,
  plan: BulkPlanItem,
  result: BulkExecItemResult,
  opts: BulkExecuteOptions,
): Promise<void> {
  try {
    await deps.recordHistory(plan.productId || null, {
      kind: opts.kind,
      key: plan.key,
      changes: changesForHistory(plan.changes),
      result_status: result.status,
      result_error: result.error ?? null,
      warnings: result.warnings,
      rakuten: result.rakuten
        ? { ok: result.rakuten.ok, updated: result.rakuten.updated, message: result.rakuten.message }
        : null,
      yahoo: result.yahoo
        ? { ok: result.yahoo.ok, updated: result.yahoo.updated, message: result.yahoo.message }
        : null,
      ...(opts.detail ?? {}),
    });
  } catch {
    result.warnings.push("履歴の記録に失敗しました");
  }
}
