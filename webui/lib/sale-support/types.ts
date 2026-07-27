import type { RakutenTaxPct } from "@/lib/converters";

/** 楽天 items.get の生JSON（構造は実機確認済み。必要な箇所だけ型ガードで読む）。 */
export type RakutenItemJson = Record<string, unknown>;

/** 販売期間（楽天 RMS items API 2.0 の purchasablePeriod）。
 * 書式は ISO8601 + JSTオフセット（例 "2026-08-01T10:00:00+09:00"）。
 * 2026-07-28 実機検証（tests/sale_support_verify.mjs）で patch → getItem 読み戻しが
 * 同一書式で往復すること・null 送信で解除できることを確認済み。 */
export type SalePeriod = { start: string; end: string };

/** セール適用プレビューの SKU 単位の計算結果（表示・hash・patch の共通素材）。 */
export type SaleSkuPlan = {
  /** variants の実キー（SKU管理番号） */
  variantKey: string;
  taxPct: RakutenTaxPct;
  /** 現在の登録税抜価格（standardPrice） */
  beforeNet: number;
  /** 現在の税込換算（税額切り捨て） */
  beforeGross: number;
  /** 割引後の登録税抜価格（これを standardPrice へ送る） */
  afterNet: number;
  /** 割引後の税込（RMS 再計算値） */
  afterGross: number;
  /** 目標割引後税込（税込×(1-％) 切り捨て） */
  targetGross: number;
  /** 目標との差額（0〜1円。税額の段差で目標に一致しない場合に 1） */
  targetDifference: number;
  /** 二重価格ONのとき referencePrice に設定する値（元の税抜価格）。OFF は null */
  referencePriceValue: number | null;
  /** 定期購入価格が設定されている（確定仕様: 変更しない） */
  hasSubscription: boolean;
};

/** 復元プレビューの SKU 単位の書き戻し内容。 */
export type RestoreSkuPlan = {
  variantKey: string;
  /** 元商品の現在の登録税抜価格（表示用。取得できなければ null） */
  currentNet: number | null;
  /** -SS コピーに控えた登録税抜価格（これを書き戻す） */
  restoreNet: number;
  /** 元商品の現在の二重価格値（表示用） */
  currentReference: string | null;
  /** -SS コピーの referencePrice オブジェクト（そのまま書き戻す）。無ければ null = 解除 */
  restoreReference: Record<string, unknown> | null;
  /** 二重価格を解除する（-SS に無く、null 送信で外す。実機検証済み） */
  referenceCleared: boolean;
};

export type SaleSupportStatus = "plan" | "ok" | "excluded" | "failed";

/** セール適用の per-item プラン（プレビュー＝実行の共通データ。raw はサーバ内専用）。 */
export type ApplyItemPlan = {
  manageNumber: string;
  ssManageNumber: string;
  status: SaleSupportStatus;
  /** excluded / failed の理由 */
  reason?: string;
  title?: string;
  /** payment.taxRate が無く 10% と仮定した場合 true（プレビューで明示） */
  taxAssumed?: boolean;
  skus?: SaleSkuPlan[];
  /** 楽天へ送る patch ボディ（プレビュー表示値と同一のものだけを実行する担保） */
  patchBody?: Record<string, unknown>;
  /** items.get の生JSON（-SS コピー・スナップショット用。API レスポンスへは出さない） */
  raw?: RakutenItemJson;
};

/** 復元の per-item プラン。 */
export type RestoreItemPlan = {
  ssManageNumber: string;
  originalManageNumber: string;
  status: SaleSupportStatus;
  reason?: string;
  title?: string;
  skus?: RestoreSkuPlan[];
  /** 書き戻す販売期間（-SS の値）。null = 解除（null 送信。実機検証済み） */
  purchasablePeriod?: SalePeriod | null;
  /** 販売期間を解除する（-SS に設定が無い場合） */
  periodCleared?: boolean;
  warnings: string[];
  patchBody?: Record<string, unknown>;
  /** 元商品の items.get 生JSON（スナップショット用。API レスポンスへは出さない） */
  rawOriginal?: RakutenItemJson;
};

/** 実行後の per-item 結果。 */
export type SaleSupportItemResult = {
  manageNumber: string;
  ssManageNumber: string;
  status: SaleSupportStatus;
  error?: string;
  warnings: string[];
  /** 実行後の読み戻し検証が一致したか（ok のとき true） */
  verified?: boolean;
};

export type SaleSupportSummary = {
  total: number;
  /** プレビュー: 実行可能件数 / 実行: 成功件数 */
  applicable: number;
  excluded: number;
  failed: number;
};

export function summarize(
  items: { status: SaleSupportStatus }[],
): SaleSupportSummary {
  const s: SaleSupportSummary = { total: items.length, applicable: 0, excluded: 0, failed: 0 };
  for (const it of items) {
    if (it.status === "plan" || it.status === "ok") s.applicable++;
    else if (it.status === "excluded") s.excluded++;
    else s.failed++;
  }
  return s;
}
