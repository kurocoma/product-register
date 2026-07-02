/** 登録サービス層の共有型。dry-run / commit のレスポンス形を単一・一括で共通化し、
 * フロント（BulkRegisterPanel）と型を共有する。 */

export type Mall = "rakuten" | "yahoo";

/** 一括登録の実行オプション（既定はすべて安全側 = dry-run・非公開・上書きなし）。 */
export type RegisterOptions = {
  /** 既定 true。false を明示したときだけ実登録（安全側既定）。 */
  dryRun?: boolean;
  /** 公開状態で登録する（既定 false = 楽天: 倉庫・在庫0 / Yahoo: display=0）。 */
  publish?: boolean;
  /** Yahoo: 登録後にストア全体の反映(reservePublish)を予約する（既定 false）。 */
  submit?: boolean;
  /** 既存商品があるとき上書きを許可する（既定 false = スキップ）。 */
  overwrite?: boolean;
};

/** 件別結果。dry-run と commit で共通の形（total/valid 集計とフロント表示の源泉）。 */
export type BulkItemResult = {
  id: string;
  ne_code: string;
  product_name: string;
  /** dry-run: 登録可能か / commit: 登録に成功したか。 */
  ok: boolean;
  /** 必須項目がそろっているか（判定不能・商品未発見は false）。 */
  valid?: boolean;
  /** モールに既存商品があり上書きになるか。 */
  willOverwrite?: boolean;
  action?: "create" | "update" | "skip";
  /** モール側キー（楽天: 商品管理番号 / Yahoo: item_code）。 */
  key?: string;
  /** 不足している必須項目（valid=false のとき）。 */
  missing?: string[];
  /** 失敗理由（ユーザー向け日本語）。 */
  error?: string;
  /** commit で実際にモールへ送信し成功したか。 */
  registered?: boolean;
};

export type BulkSummary = {
  total: number;
  valid: number;
  invalid: number;
  willOverwrite: number;
  /** commit のみ意味を持つ（dry-run では 0）。 */
  succeeded: number;
  failed: number;
};

export type BulkResponse = {
  ok: boolean;
  mall: Mall;
  dryRun: boolean;
  /** Yahoo commit + submit 時のみ: ストア反映予約の結果。 */
  submitted?: boolean;
  submitMessage?: string;
  error?: string;
} & BulkSummary & { results: BulkItemResult[] };

/** サービス層の失敗（route が HTTP ステータスへマッピングする）。 */
export type RegisterServiceError =
  | { ok: false; kind: "invalid"; error: string; missing: string[] }
  | { ok: false; kind: "auth"; error: string }
  | {
      ok: false;
      kind: "api";
      error: string;
      apiStatus?: number;
      detail?: string;
      errors?: string[];
      warnings?: string[];
    };
