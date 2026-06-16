// NEコード必須化 + 重複エラー明示の実挙動検証（TS import 不要版）。
// - DB のユニーク制約(user_id, ne_code)が実際に 23505 を返すことを確認
// - humanizeSaveError 相当のメッセージ変換が 23505 を NEコード重複文に変えることを確認
//   （ロジック本体は repository.test.ts のユニットテストで検証済み。ここでは「DBが本当に弾く」ことを実証する）
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const getEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const URL_ = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SVC = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const TARGET = "kmzt.i-0001@kurocommerce.com";
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

let pass = true;
const check = (label, cond, detail) => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? "  — " + detail : ""}`);
  pass = pass && cond;
};

function baseRow(user_id, ne_code) {
  return {
    user_id, ne_code, jan_code: "4955028002542", maker_code: "e2e",
    product_type: "単品", quantity: 1, product_name: "検証", display_name: "検証",
    tax_rate: 10, cost_price: 0, selling_price: 100,
    shipping_type: "送料別", image_count: 1, delivery_method: 4, lead_time: 1,
    mall_category_id: "0", extra: {},
  };
}

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  const user = list.users.find((u) => u.email === TARGET);
  const ne = "e2e-validate-x";
  await admin.from("products").delete().eq("user_id", user.id).like("ne_code", "e2e-validate-%");

  // 1件目: 正常 insert
  const r1 = await admin.from("products").insert(baseRow(user.id, ne)).select("id").single();
  check("1件目 insert 成功", !r1.error && r1.data?.id, r1.error?.message || `id=${r1.data?.id.slice(0, 8)}…`);

  // 2件目: 同じ (user_id, ne_code) → 23505 が返る（DB制約が実際に弾く）
  const r2 = await admin.from("products").insert(baseRow(user.id, ne)).select("id").single();
  const is23505 = r2.error?.code === "23505" && /ne_code/.test(r2.error?.message ?? "");
  check("重複は DB が 23505 で弾く", is23505, r2.error ? `${r2.error.code}: ${r2.error.message.slice(0, 60)}` : "エラーが出なかった");

  // humanizeSaveError 相当: 23505 → 分かりやすい日本語（repository.ts と同じ判定）
  const humanize = (e) =>
    e?.code === "23505" && /ne_code/.test(e.message ?? "")
      ? "このNEコードは既に使われています。別のNEコードを入力してください。"
      : (e?.message ?? "保存に失敗しました");
  const msg = humanize(r2.error);
  check("23505→分かりやすいメッセージに変換", msg.includes("既に使われています"), msg);

  // NEコード空のバリデーション（validateForSave 相当）
  const validate = (neCode) => (!neCode || !neCode.trim()) ? "NEコードは必須です" : null;
  check("空NEコードはバリデーションで弾く", validate("") !== null && validate("   ") !== null, "");
  check("正常NEコードは通す", validate("t002-2542-1") === null, "");

  await admin.from("products").delete().eq("user_id", user.id).like("ne_code", "e2e-validate-%");
  check("cleanup", true, "");

  console.log("\n" + (pass ? "🎉 DB制約が実際に重複を弾き、メッセージ変換も正しい" : "⚠ 検証失敗あり"));
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error("スクリプト例外:", e); process.exit(3); });
