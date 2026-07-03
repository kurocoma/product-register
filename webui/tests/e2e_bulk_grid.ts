// 一括登録グリッドの実機E2E（モール送信なし・products DB まで）。
//   1) サイドナビに「一括登録」→ /bulk-register が現れるか（SSR HTML を検査）
//   2) /bulk-register が認証済みで 200 で描画されるか（グリッド見出しの存在）
//   3) グリッドの省力化フロー: 単品1行入力 → セット行3行自動展開 → 一括保存(upsertProduct)
//      → 一覧(listProducts)に4商品 → 再保存が更新になる(重複しない) → 後片付け(削除)
// 使い方(webui): dev server を起動した状態で  npx tsx tests/e2e_bulk_grid.ts
//   ベースURLは E2E_BASE（既定 http://localhost:3000）
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";

(async () => {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
  const BASE = process.env.E2E_BASE || "http://localhost:3000";

  const { createClient } = await import("@supabase/supabase-js");
  const { createServerClient } = await import("@supabase/ssr");
  const { applyFieldChange, emptyGridRow, expandSetRows, gridRowToProductInput, validateGridRows } = await import("@/lib/product/grid-rows");
  const { upsertProduct, deleteProduct, listProducts } = await import("@/lib/product/repository");

  const results: { step: string; ok: boolean; detail?: string }[] = [];
  const record = (step: string, ok: boolean, detail = "") => {
    results.push({ step, ok, detail });
    console.log(`${ok ? "✅" : "❌"} ${step}${detail ? "  — " + detail : ""}`);
  };
  const finish = () => {
    const ng = results.filter((r) => !r.ok).length;
    console.log(`\n=== ${results.length - ng}/${results.length} passed ===`);
    process.exit(ng > 0 ? 1 : 0);
  };

  // --- 認証セッション（既存 e2e と同じ: admin generateLink → verifyOtp → cookie jar） ---
  const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = list.users.find((u) => u.email === "kurocommerce@gmail.com")!;
  const jar = new Map<string, string>();
  const ssr = createServerClient(URL_, ANON, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l: any) => l.forEach(({ name, value }: any) => jar.set(name, value)) } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email! });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: (link as any).properties.hashed_token });
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  record("セッション確立", jar.size > 0, `user=${user.email}`);

  const get = (path: string) => fetch(BASE + path, { redirect: "manual", headers: { Cookie: cookie } });

  // --- 1) サイドナビ: どの画面の SSR にも「一括登録」→ /bulk-register が入る ---
  {
    const res = await get("/products");
    const html = await res.text();
    record("SSR /products", res.status === 200, `HTTP ${res.status}`);
    record("サイドナビに「一括登録」", html.includes("一括登録") && html.includes("/bulk-register"), "リンク先 /bulk-register");
  }

  // --- 2) /bulk-register が描画される（グリッドの見出し列を含む） ---
  {
    const res = await get("/bulk-register");
    const html = await res.text();
    record("SSR /bulk-register", res.status === 200, `HTTP ${res.status}`);
    const heads = ["一括登録（まとめて入力）", "NEコード", "JANコード", "掲載商品名", "キャッチコピー(Yahoo)"];
    const missing = heads.filter((h) => !html.includes(h));
    record("グリッド見出し18列相当の描画", missing.length === 0, missing.length ? `不足: ${missing.join(",")}` : "見出しOK");
  }

  // --- 3) 単品1行 → セット3行自動展開 → 保存 → 一覧に4商品 ---
  const codes = ["e2egrid-4916-1", "e2egrid-4916-6", "e2egrid-4916-24", "e2egrid-4916-48"];
  const createdIds: string[] = [];
  try {
    // 事前クリーンアップ（前回失敗の残骸があれば消す）
    const before = await listProducts(ssr as any);
    for (const p of before.filter((p) => codes.includes(String(p.ne_code)))) await deleteProduct(ssr as any, p.id);

    // 単品行をセル編集の経路(applyFieldChange)で組み立てる（NEコード・掲載商品名は自動補完に任せる）
    let row = emptyGridRow();
    row = applyFieldChange(row, "maker_code", "e2egrid");
    row = applyFieldChange(row, "jan_code", "4514603474916");
    row = applyFieldChange(row, "product_name", "E2E 島レモネード PET 500ml");
    row = applyFieldChange(row, "tax_rate", "8");
    row = applyFieldChange(row, "selling_price", "200");
    row = applyFieldChange(row, "mall_category_id", "110692");
    record("NEコード自動生成", row.ne_code === "e2egrid-4916-1", `ne_code=${row.ne_code}`);
    record("掲載商品名の自動補完", row.display_name === "E2E 島レモネード PET 500ml", `display_name=${row.display_name}`);

    // セット行を3行自動展開 → 販売価格だけ入力
    const sets = expandSetRows(row, [6, 24, 48]).map((r, i) => applyFieldChange(r, "selling_price", ["2100", "5480", "9800"][i]));
    record("セット行3行の自動展開", sets.length === 3 && sets.map((s) => s.ne_code).join(",") === "e2egrid-4916-6,e2egrid-4916-24,e2egrid-4916-48", sets.map((s) => s.ne_code).join(","));

    const grid = [row, ...sets];
    const validation = validateGridRows(grid);
    record("4行とも検証エラーなし", validation.size === 0, validation.size ? JSON.stringify([...validation.entries()]) : "OK");

    // 一括保存（画面と同じ経路: gridRowToProductInput → upsertProduct）
    for (const r of grid) {
      const saved = await upsertProduct(ssr as any, gridRowToProductInput(r));
      createdIds.push(saved.id);
    }
    record("一括保存(4件 insert)", createdIds.length === 4, `ids=${createdIds.map((i) => i.slice(0, 8)).join(",")}`);

    // 一覧に4商品が現れる
    const after = await listProducts(ssr as any);
    const found = after.filter((p) => codes.includes(String(p.ne_code)));
    record("一覧に4商品", found.length === 4, `found=${found.map((p) => p.ne_code).join(",")}`);
    const set6 = found.find((p) => p.ne_code === "e2egrid-4916-6");
    record("セット行の内容（数量6・セット商品・価格2100）", !!set6 && set6.product_type === "セット商品" && Number(set6.quantity) === 6 && Number(set6.selling_price) === 2100, set6 ? `${set6.product_type}/${set6.quantity}/${set6.selling_price}` : "not found");

    // 再保存は savedId 指定で更新（重複 insert しない）— 画面の「保存済→再保存」経路
    const updated = await upsertProduct(ssr as any, gridRowToProductInput(applyFieldChange(row, "selling_price", "250")), createdIds[0]);
    const after2 = await listProducts(ssr as any);
    record("再保存は更新（件数不変・価格反映）", after2.filter((p) => codes.includes(String(p.ne_code))).length === 4 && Number(updated.selling_price) === 250, `selling=${updated.selling_price}`);

    // savedId なしで同じ NEコードを再 insert → ユニーク制約の日本語エラー
    try {
      await upsertProduct(ssr as any, gridRowToProductInput(row));
      record("NEコード重複は日本語エラー", false, "エラーにならなかった");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record("NEコード重複は日本語エラー", msg.includes("既に使われています"), msg.slice(0, 60));
    }
  } finally {
    // --- 後片付け ---
    const now = await listProducts(ssr as any);
    for (const p of now.filter((p) => codes.includes(String(p.ne_code)))) await deleteProduct(ssr as any, p.id);
    const remain = (await listProducts(ssr as any)).filter((p) => codes.includes(String(p.ne_code)));
    record("後片付け（テスト商品削除）", remain.length === 0, `remain=${remain.length}`);
  }

  finish();
})();
