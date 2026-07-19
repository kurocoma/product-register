/** フォーム数値入力の空欄セーフ変換。react-hook-form の register オプション
 * `{ setValueAs: emptySafeNumber }` として使う。
 *
 * 背景: `valueAsNumber: true` は空欄を NaN にする。NaN は ProductInputSchema.parse で
 * 弾かれ、ProductForm の同期が無言で止まり「編集しても保存されない」状態になる
 * （楽天定期購入 IE0433 が入力しても消えない不具合の一因）。
 * 空欄・数値にならない値は undefined に落とし、zod の default() / optional() に委ねる。 */
export function emptySafeNumber(x: unknown): number | undefined {
  if (x === "" || x == null) return undefined;
  const n = Number(x);
  return Number.isNaN(n) ? undefined : n;
}
