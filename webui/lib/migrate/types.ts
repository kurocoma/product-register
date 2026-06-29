/** 楽天→Yahoo 一括移行の契約型を1箇所に固定する。
 * API ルート / UI パネル / 単体テストが同じ per-item 契約を共有し、レスポンス形をブレさせないための土台。
 * このファイルは型のみ（副作用なし・I/O 非依存）。 */

/** 移行処理の段階。per-item の進行表示・失敗箇所の特定に使う。
 * submit(公開)は本機能のスコープ外（submitItem は呼ばない＝安全側）なので段階に含めない。 */
export type MigrationStep = "import" | "category" | "register" | "image";

/** per-item の判定/結果ステータス。
 * - migrate: 移行可能（plan 判定の結果。実行前）
 * - requires_manual: 安全のため自動移行せず手動対応が必要
 * - skipped: 入力不正・対象外でスキップ
 * - failed: 実行中に失敗
 * - ok: 実行成功（移行完了） */
export type ItemStatus = "migrate" | "requires_manual" | "skipped" | "failed" | "ok";

/** plan 判定でのアクション。ItemStatus の実行前サブセット。 */
export type PlanAction = "migrate" | "requires_manual";

/** parseManageNumbers の結果。
 * - valid: 正規化済み・重複除去済みの有効な楽天商品管理番号
 * - invalid: 文字種違反/桁超過などで弾いた入力（理由付き）
 * - duplicatesRemoved: 取り除いた重複トークン数 */
export type ManageNumberParseResult = {
  valid: string[];
  invalid: { raw: string; reason: string }[];
  duplicatesRemoved: number;
};

/** buildItemPlan の入力。取込・カテゴリ解決・SKU/設定検出などの I/O は
 * 呼び出し側で済ませて結果だけを注入する（buildItemPlan 自体は純関数）。 */
export type ItemPlanInput = {
  manageNumber: string;
  /** Yahoo 側に同一商品が既存か（更新になるか新規になるか）。移行可否はブロックしない。 */
  existed: boolean;
  /** Yahoo カテゴリの解決可否。null/false=未解決（マッピング無し）→自動移行不可。 */
  yahooCategoryResolved: boolean | null;
  /** 1商品ページに複数 SKU(variants)があるか。true=安全のため手動。 */
  hasMultipleSku: boolean;
  /** 自動移行で誤反映しうる高度な Yahoo 設定があるか。true=安全のため手動。 */
  hasAdvancedYahooSettings: boolean;
  /** Yahoo 登録に必要だが未充足の項目名。空でなければ手動。 */
  missingRequiredYahooFields: string[];
};

/** per-item の移行計画（dry-run プレビューの1行）。 */
export type MigrationItemPlan = {
  manageNumber: string;
  action: PlanAction;
  /** requires_manual になった理由（複合可）。migrate なら空配列。 */
  reasons: string[];
  existed: boolean;
  categoryResolved: boolean;
  hasMultipleSku: boolean;
  hasAdvancedYahooSettings: boolean;
  missingRequiredYahooFields: string[];
};

/** per-item の実行結果（commit 後の1行）。 */
export type MigrationItemResult = {
  manageNumber: string;
  /** 登録できた場合の内部商品ID（任意）。 */
  productId?: string;
  /** どの段階での結果か。 */
  step: MigrationStep;
  ok: boolean;
  status: ItemStatus;
  /** 失敗/手動時の理由。 */
  error?: string;
};

/** 移行全体の集計サマリ。total = 各カテゴリの合計。 */
export type MigrationSummary = {
  total: number;
  migrated: number;
  requiresManual: number;
  skipped: number;
  failed: number;
};

/** Yahoo 登録時の安全状態の既定値。
 * 実効的な安全機構は yahooDisplay=0（非表示）と registerPublish=false（submitItem 非実行）。
 * 在庫(stock)は editItem の対象外（Yahoo の在庫は別 API で管理）のため、本フローからは
 * 実際には送信していない。意図（安全既定では在庫を増やさない）を表す参考値として保持する。 */
export type SafeStateDefaults = {
  /** Yahoo 表示状態。0=非表示（実効的な安全機構）。 */
  yahooDisplay: number;
  /** 在庫数の意図値（安全既定は 0）。注意: editItem には在庫列が無く、本フローでは送信しない。 */
  stock: number;
  /** 登録 API の公開フラグ。 */
  registerPublish: boolean;
};
