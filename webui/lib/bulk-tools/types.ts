import type { ProductInput } from "@/lib/product/schema";

/** 一括ツール（JAN売価変更・お知らせ一括追記・商品名セール文言）共通の状態。
 * sale-support と同じ4状態: plan=実行可(プレビュー) / ok=完了 / excluded=対象外 / failed=失敗。 */
export type BulkToolStatus = "plan" | "ok" | "excluded" | "failed";

/** 変更内容の1項目（プレビュー表示・payloadHash・履歴の共通素材）。
 * before/after は完全な値を保持し、hash によって「プレビューで表示した値と同一のものだけを
 * 実行する」を担保する（DB がプレビュー後に変わると hash が変わり 409 で再プレビュー）。 */
export type BulkFieldChange = {
  field: string;
  /** 多SKUの価格変更で対象SKUキー（フラット商品は undefined） */
  variantKey?: string;
  before: unknown;
  after: unknown;
};

/** プレビュー＝実行の共通 per-item プラン（mutated はサーバ内専用）。 */
export type BulkPlanItem = {
  /** 表示用の管理番号（rakuten_manage_number 優先、無ければ NEコード） */
  key: string;
  productId: string;
  status: BulkToolStatus;
  reason?: string;
  title?: string;
  changes: BulkFieldChange[];
  warnings: string[];
  /** 実行用の更新後 ProductInput（サーバ内専用。API レスポンスへは出さない） */
  mutated?: ProductInput;
  /** 楽天 patch に salesDescription（PC販売説明文）を含める（機能2＝お知らせ追記/解除専用。
   * 既存 buildRakutenPatchBody は salesDescription 非対応のため mall-push が追加する） */
  includeSalesDescription?: boolean;
};

/** モール1つへの反映結果。 */
export type MallPushOutcome = {
  /** モールAPIへ到達したか（未掲載・認証未設定は false） */
  attempted: boolean;
  ok: boolean;
  message: string;
  /** 実際に送信（patch / editItem）した件数。Yahoo は分割擬似商品（SKU別 item_code）単位 */
  updated: number;
  /** 送れなかった変更の明示（buildRakutenPatchBody / buildYahooUpdateParams の skipped） */
  skipped: string[];
};

/** 実行後の per-item 結果。 */
export type BulkExecItemResult = {
  key: string;
  productId: string;
  status: BulkToolStatus;
  error?: string;
  warnings: string[];
  rakuten?: MallPushOutcome;
  yahoo?: MallPushOutcome;
};

export type BulkSummary = {
  total: number;
  /** プレビュー: 実行可能件数 / 実行: 成功件数 */
  applicable: number;
  excluded: number;
  failed: number;
};

export function summarizeBulk(items: { status: BulkToolStatus }[]): BulkSummary {
  const s: BulkSummary = { total: items.length, applicable: 0, excluded: 0, failed: 0 };
  for (const it of items) {
    if (it.status === "plan" || it.status === "ok") s.applicable++;
    else if (it.status === "excluded") s.excluded++;
    else s.failed++;
  }
  return s;
}

/** Yahoo 反映予約（reservePublish mode=1）の実行結果。 */
export type ReserveOutcome = {
  requested: boolean;
  executed: boolean;
  ok: boolean;
  message: string;
};
