import Papa from "papaparse";
import iconv from "iconv-lite";
import type { Encoding } from "@/lib/converters/base";

/** CSV をエンコーディング指定で生成する。 */
export function writeCsv(rows: Record<string, string>[], encoding: Encoding): Buffer {
  if (rows.length === 0) return Buffer.alloc(0);
  // papaparse はレコード境界を CRLF で吐く
  const csv = Papa.unparse(rows, { newline: "\r\n", quotes: false });

  if (encoding === "utf-8") {
    return Buffer.from(csv, "utf-8");
  }
  if (encoding === "utf-8-sig") {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, "utf-8")]);
  }
  // cp932
  return iconv.encode(csv, "cp932");
}
