/** 登録後の状態（楽天）の選択肢と、commit オプションへの対応付け（260720）。
 * - publish   = 公開で登録（倉庫から出す。既存の倉庫商品の解除にも使う）
 * - keep      = 既存の倉庫/公開状態を現状維持（新規には維持対象が無いため倉庫になる）
 * - warehouse = 倉庫に入れる（従来の安全登録・既定）
 * 不明値は安全側（倉庫）に倒す。 */
export type RegisterState = "publish" | "keep" | "warehouse";

export function registerStateToOpts(
  state: RegisterState,
): { publish?: boolean; keepExistingState?: boolean } {
  if (state === "publish") return { publish: true };
  if (state === "keep") return { keepExistingState: true };
  return {};
}

/** 画面の既定値: 新規=倉庫（安全側）／既存上書き=現状維持（公開中を落とさない）。 */
export function defaultRegisterState(willOverwrite: boolean): RegisterState {
  return willOverwrite ? "keep" : "warehouse";
}
