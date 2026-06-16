// 楽天→Yahoo カテゴリマッピング CSV を rakuten_yahoo_category_mapping へ取り込む。
// docs/rakuten_yahoo_category_mapping.csv (UTF-8 BOM) を読み → COPY で bulk insert。
// 既存 import_genre_attributes.mjs と同じ方式（TRUNCATE → COPY、冪等）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import pgCopyStreams from "pg-copy-streams";
import { loadDbConfig } from "./db.mjs";
import pg from "pg";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// 既定はリポジトリ docs/ の成果物 CSV。引数で上書き可。
const DEFAULT_CSV = fileURLToPath(
  new URL("../../docs/rakuten_yahoo_category_mapping.csv", import.meta.url),
);
const CSV_PATH = process.argv[2] || DEFAULT_CSV;

// CSV列 → DB列。match_reason はランタイム不要のため取り込まない。
const COLS = [
  "genre_id", "rakuten_path", "yahoo_category_id",
  "yahoo_category_name", "yahoo_path", "confidence", "match_method",
];

function buildRow(r) {
  return {
    genre_id: (r.rakuten_genre_id ?? "").trim(),
    rakuten_path: r.rakuten_path ?? "",
    yahoo_category_id: r.yahoo_category_id ?? "",
    yahoo_category_name: r.yahoo_category_name ?? "",
    yahoo_path: r.yahoo_path ?? "",
    confidence: r.confidence ?? "",
    match_method: r.match_method ?? "",
  };
}

// COPY 用に1行をタブ区切りTSVへ（NULL は \\N、特殊文字をエスケープ）
function tsvCell(v) {
  if (v === null || v === undefined) return "\\N";
  return String(v).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

async function main() {
  console.log("CSV読み込み:", CSV_PATH);
  let text = readFileSync(CSV_PATH, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM除去
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  console.log("総データ行数:", rows.length);

  // genre_id でユニーク化（CSVは1ジャンル1行だが防御的に最初の1件を採用）
  const byGenre = new Map();
  for (const r of rows) {
    const row = buildRow(r);
    if (row.genre_id && !byGenre.has(row.genre_id)) byGenre.set(row.genre_id, row);
  }
  const dataRows = [...byGenre.values()];
  const withYahoo = dataRows.filter((r) => r.yahoo_category_id).length;
  console.log(`取り込み対象: ${dataRows.length} ジャンル（うち Yahoo紐付けあり ${withYahoo}）`);

  const client = new pg.Client(loadDbConfig());
  await client.connect();
  try {
    await client.query("TRUNCATE rakuten_yahoo_category_mapping");
    console.log("既存データをTRUNCATE。COPYで投入開始...");

    const copyStream = client.query(
      pgCopyStreams.from(`COPY rakuten_yahoo_category_mapping (${COLS.join(",")}) FROM STDIN WITH (FORMAT text)`),
    );
    const tsvSource = Readable.from((function* () {
      for (const row of dataRows) {
        yield COLS.map((c) => tsvCell(row[c])).join("\t") + "\n";
      }
    })());
    await pipeline(tsvSource, copyStream);

    const cnt = await client.query(
      "SELECT count(*)::int n, count(*) FILTER (WHERE yahoo_category_id <> '')::int matched FROM rakuten_yahoo_category_mapping",
    );
    console.log(`✅ 投入完了: ${cnt.rows[0].n} ジャンル / Yahoo紐付け ${cnt.rows[0].matched} 件`);
    const sample = await client.query(
      "SELECT genre_id, yahoo_category_id, yahoo_path, confidence FROM rakuten_yahoo_category_mapping WHERE yahoo_category_id <> '' LIMIT 3",
    );
    console.log("サンプル:");
    sample.rows.forEach((r) => console.log("  ", JSON.stringify(r)));
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error("import失敗:", e); process.exit(1); });
