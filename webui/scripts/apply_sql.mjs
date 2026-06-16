// 指定した .sql ファイルを .env.local の SUPABASE_DB_URL 経由で直接適用する。
// supabase link/db push が使えない環境向けの簡易適用ヘルパー。
// マイグレーションは CREATE ... IF NOT EXISTS 等で冪等に書く前提。
import { readFileSync } from "node:fs";
import { withClient } from "./db.mjs";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("usage: node scripts/apply_sql.mjs <path-to.sql>");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
await withClient(async (client) => {
  await client.query(sql); // simple query protocol: 複数ステートメントをまとめて実行
  console.log("✅ 適用完了:", sqlPath);
}).catch((e) => {
  console.error("適用失敗:", e.message || e);
  process.exit(1);
});
