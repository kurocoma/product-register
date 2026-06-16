// 楽天 商品属性リスト(ichiba_attribute_list)CSVを rakuten_genre_attributes へ取り込む。
// CP932デコード → 列マッピング → COPY で高速 bulk insert。
import { readFileSync } from "node:fs";
import iconv from "iconv-lite";
import Papa from "papaparse";
import pgCopyStreams from "pg-copy-streams";
import { loadDbConfig } from "./db.mjs";
import pg from "pg";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const CSV_PATH = process.argv[2] || "C:/Users/hppym/AppData/Local/Temp/ichiba_attribute.csv";

// CSVヘッダー → DB列 のマッピング（列インデックス）
// 0:ジャンルID 1:パス名 2:定義書 3:詳細グループ 4:項目名 5:必須/任意 6:入力方式
// 7:推奨値・選択肢の有無 8:入力フォーマット 9:最大文字数 10:日付形式 11:単位有無
// 12:楽天推奨単位 13:楽天推奨単位一覧 14:複数値可不可 15:区切り入力最大数
// 16:最小値 17:最大値 18:商品ページ内同一値登録対象 19:並び順
const toBool = (v) => v === "可" || v === "あり" || (typeof v === "string" && v.startsWith("有"));
const toInt = (v) => {
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

function buildRow(cols) {
  return {
    genre_id: cols[0] ?? "",
    path_name: cols[1] ?? "",
    item_name: cols[4] ?? "",
    requirement: cols[5] ?? "",
    input_method: cols[6] ?? "",
    has_choices: toBool(cols[7]),
    has_unit: toBool(cols[11]),
    recommended_unit: cols[12] === "-" ? "" : (cols[12] ?? ""),
    unit_choices: cols[13] === "-" ? "" : (cols[13] ?? ""),
    max_length: toInt(cols[9]),
    multiple_allowed: toBool(cols[14]),
    sort_order: toInt(cols[19]) ?? 0,
  };
}

// COPY 用に1行をタブ区切りTSVへ（NULL は \\N、特殊文字をエスケープ）
function tsvCell(v) {
  if (v === null || v === undefined) return "\\N";
  if (typeof v === "boolean") return v ? "t" : "f";
  return String(v).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

async function main() {
  console.log("CSV読み込み:", CSV_PATH);
  const buf = readFileSync(CSV_PATH);
  const text = iconv.decode(buf, "cp932");
  const parsed = Papa.parse(text, { skipEmptyLines: true });
  const rows = parsed.data;
  console.log("総行数(ヘッダー含む):", rows.length);
  const header = rows[0];
  console.log("ヘッダー先頭3列:", header.slice(0, 3).join(" / "));

  const dataRows = rows.slice(1).filter((r) => r[0] && r[4]); // ジャンルIDと項目名がある行のみ
  console.log("取り込み対象行:", dataRows.length);

  const COLS = ["genre_id", "path_name", "item_name", "requirement", "input_method",
    "has_choices", "has_unit", "recommended_unit", "unit_choices", "max_length",
    "multiple_allowed", "sort_order"];

  const client = new pg.Client(loadDbConfig());
  await client.connect();
  try {
    // 既存データを消してから入れ直す（冪等）
    await client.query("TRUNCATE rakuten_genre_attributes RESTART IDENTITY");
    console.log("既存データをTRUNCATE。COPYで投入開始...");

    const copyStream = client.query(
      pgCopyStreams.from(`COPY rakuten_genre_attributes (${COLS.join(",")}) FROM STDIN WITH (FORMAT text)`),
    );
    const tsvSource = Readable.from((function* () {
      let n = 0;
      for (const r of dataRows) {
        const row = buildRow(r);
        yield COLS.map((c) => tsvCell(row[c])).join("\t") + "\n";
        if (++n % 50000 === 0) console.error(`  ${n} 行生成...`);
      }
    })());
    await pipeline(tsvSource, copyStream);

    const cnt = await client.query("SELECT count(*)::int n, count(DISTINCT genre_id)::int g FROM rakuten_genre_attributes");
    console.log(`✅ 投入完了: ${cnt.rows[0].n} 行 / ${cnt.rows[0].g} ジャンル`);
    // サンプル確認
    const sample = await client.query("SELECT genre_id,item_name,requirement,recommended_unit,unit_choices,sort_order FROM rakuten_genre_attributes WHERE has_unit=true LIMIT 3");
    console.log("単位ありサンプル:");
    sample.rows.forEach((r) => console.log("  ", JSON.stringify(r)));
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error("import失敗:", e); process.exit(1); });
