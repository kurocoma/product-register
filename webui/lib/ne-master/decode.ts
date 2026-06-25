/** CSVバイト列を文字列へ。BOM除去。まずUTF-8(厳格)、不正ならShift-JIS(CP932)。
 * NEマスタはCP932、Excel変換CSVはUTF-8 のため両対応する。 */
export function decodeCsvBytes(buf: ArrayBufferLike | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // UTF-8 BOM
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(u8.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder("shift_jis").decode(u8);
  }
}
