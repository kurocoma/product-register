// 一括登録グリッド「バリエーションキー統合 + カテゴリ自動補完」の実機E2E（モール送信なし・products DB まで）。
//   1) /bulk-register の SSR にバリエーションキー列・統合/自動補完の説明が現れるか
//   2) バリエーションキー入りテンプレ（BULK_GRID_COLUMNS）→ 貼り付け → buildProductsFromRows で
//      1商品（variants 2 SKU・rakuten_manage_number=メーカーコード-JAN下4桁）になるか
//   3) products/new と同一ソース（fetchGenreAttributes / fetchYahooCategoryMapping）で自動補完されるか
//   4) 保存(upsertProduct) → DB 読み戻しで variants / variation_key / rakuten_manage_number が往復するか
//      → 商品編集画面(/products/[id]) が 200 で描画されるか → NE用CSVはSKUごとに行が分かれるか → 後片付け
// 使い方(webui): dev server を起動した状態で  npx tsx tests/e2e_bulk_variation.ts
//   ベースURLは E2E_BASE（既定 http://localhost:3000）
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";

(async () => {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
  const BASE = process.env.E2E_BASE || "http://localhost:3000";

  const { createClient } = await import("@supabase/supabase-js");
  const { createServerClient } = await import("@supabase/ssr");
  const Papa = (await import("papaparse")).default;
  const { BULK_GRID_COLUMNS, buildProductsFromRows, buildTemplateCsv, parseTsv, applyFieldChange } =
    await import("@/lib/product/grid-rows");
  const { applyCategoryAutofill } = await import("@/lib/product/category-autofill");
  const { fetchGenreAttributes } = await import("@/lib/product/genre-attributes");
  const { fetchYahooCategoryMapping } = await import("@/lib/product/category-mapping");
  const { upsertProduct, deleteProduct, listProducts, dbRowToProductInput } = await import("@/lib/product/repository");
  const { NEConverter } = await import("@/lib/converters/ne");

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

  // --- 1) /bulk-register の SSR: バリエーションキー列と説明文 ---
  {
    const res = await get("/bulk-register");
    const html = await res.text();
    record("SSR /bulk-register", res.status === 200, `HTTP ${res.status}`);
    record("「バリエーションキー」列見出しの描画", html.includes("バリエーションキー"), "");
    record("統合の説明文（同じ商品管理番号のSKU）", html.includes("SKU"), "");
    record("カテゴリ自動補完の説明文", html.includes("モール基本カテゴリIDだけ入力すればOK"), "");
  }

  // --- 2) テンプレ（28列・入力例2行）→ 貼り付け → 統合 ---
  const csv = buildTemplateCsv(BULK_GRID_COLUMNS);
  const data = (Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: true }).data ?? []);
  const toTsvLine = (cells: string[]) => cells.map((c) => (/[\t\n\r"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join("\t");
  let rows = parseTsv(data.map(toTsvLine).join("\r\n"));
  record("テンプレ貼り付けで2行取込（見出し・※説明行はスキップ）", rows.length === 2, `rows=${rows.length}`);

  // 実データと衝突しないよう maker を e2evar に変え、NEコードを再生成
  rows = rows.map((r) => {
    let x = applyFieldChange(r, "maker_code", "e2evar");
    x = applyFieldChange(x, "ne_code", "");
    return x;
  });
  record("NEコード再生成", rows[0].ne_code === "e2evar-4916-1" && rows[1].ne_code === "e2evar-4916-6", `${rows[0].ne_code} / ${rows[1].ne_code}`);

  const built = buildProductsFromRows(rows);
  record("同一バリエーションキー2行 → 1商品に統合", built.length === 1 && !!built[0].input, `built=${built.length}`);
  let product = built[0].input!;
  record("variants = 2 SKU（NEコード・数量・価格）",
    product.variants.length === 2 &&
    product.variants[0].ne_code === "e2evar-4916-1" && product.variants[0].quantity === 1 && product.variants[0].selling_price === 200 &&
    product.variants[1].ne_code === "e2evar-4916-6" && product.variants[1].quantity === 6 && product.variants[1].selling_price === 1080,
    product.variants.map((v) => `${v.ne_code}:${v.quantity}:${v.selling_price}`).join(", "));
  record("楽天商品管理番号 = メーカーコード-JAN下4桁", product.rakuten_manage_number === "e2evar-4916", product.rakuten_manage_number);
  record("バリエーションキーが商品に保存される", product.variation_key === "レモネード500", product.variation_key);

  // --- 3) カテゴリ自動補完（products/new と同一ソースの fetch を使用） ---
  {
    const attrs = await fetchGenreAttributes(ssr as any, product.mall_category_id);
    const yahoo = await fetchYahooCategoryMapping(ssr as any, product.mall_category_id);
    // テンプレ例の Yahoo 2列は空欄（「カテゴリIDのみ入力→保存で補完」を例自体が体現）→ そのまま補完させる
    record("テンプレ例のYahooカテゴリID/パスは空欄（自動補完デモ）", product.yahoo_category_id === "" && product.yahoo_path === "", `id=「${product.yahoo_category_id}」 path=「${product.yahoo_path}」`);
    const { product: filledProduct, filled } = applyCategoryAutofill(product as any, attrs, yahoo);
    record(`カテゴリ${product.mall_category_id}の推奨属性取得（products/newと同一ソース）`, true, `attrs=${attrs.length}件, yahoo=${yahoo ? yahoo.yahoo_category_id : "なし"}`);
    if (attrs.length > 0) {
      record("商品属性（項目・単位）が自動設定される", filled.attributes && filledProduct.attributes.length === attrs.length && filledProduct.variants.every((v) => v.attributes.length === attrs.length),
        filledProduct.attributes.map((a) => `${a.item}(${a.unit})`).join(", "));
    }
    if (yahoo) {
      record("YahooカテゴリIDが自動補完される", filled.yahoo && filledProduct.yahoo_category_id === yahoo.yahoo_category_id, `yahoo_category_id=${filledProduct.yahoo_category_id}`);
      // 手入力優先: 手で値を入れた場合は上書きされない
      const manual = { ...product, yahoo_category_id: "99999", yahoo_path: "手入力＞パス" };
      const { product: kept } = applyCategoryAutofill(manual as any, attrs, yahoo);
      record("手入力のYahooカテゴリIDは上書きしない", kept.yahoo_category_id === "99999" && kept.yahoo_path === "手入力＞パス", `kept=${kept.yahoo_category_id}`);
      product = filledProduct as any;
    }
  }

  // --- 4) 保存 → 読み戻し → 編集画面 → NE展開 → 後片付け ---
  try {
    const before = await listProducts(ssr as any);
    for (const p of before.filter((p) => String(p.ne_code).startsWith("e2evar-"))) await deleteProduct(ssr as any, p.id);

    const saved = await upsertProduct(ssr as any, product as any);
    record("統合商品を保存(insert)", !!saved.id, `id=${saved.id.slice(0, 8)} ne_code=${saved.ne_code}`);

    const after = await listProducts(ssr as any);
    const mine = after.filter((p) => String(p.ne_code).startsWith("e2evar-"));
    record("一覧には1商品だけ（SKUは行にならない）", mine.length === 1, `count=${mine.length}`);

    const restored = dbRowToProductInput(mine[0] as any);
    record("DB往復: variants 2 SKU が残る", restored.variants.length === 2 && restored.variants[1].ne_code === "e2evar-4916-6", restored.variants.map((v) => v.ne_code).join(","));
    record("DB往復: variation_key / rakuten_manage_number", restored.variation_key === "レモネード500" && restored.rakuten_manage_number === "e2evar-4916", `${restored.variation_key} / ${restored.rakuten_manage_number}`);
    record("DB往復: 自動補完した属性が保存商品に入る", (restored.attributes?.length ?? 0) > 0 || (await fetchGenreAttributes(ssr as any, product.mall_category_id)).length === 0, `attributes=${restored.attributes?.length ?? 0}件`);

    const page = await get(`/products/${mine[0].id}`);
    record("商品編集画面(/products/[id])が描画される", page.status === 200, `HTTP ${page.status}`);
    const pageHtml = await page.text();
    record("編集画面のSKU一覧に統合した2SKUが表示される",
      pageHtml.includes("SKU一覧") && pageHtml.includes("e2evar-4916-1") && pageHtml.includes("e2evar-4916-6"),
      `SKU一覧=${pageHtml.includes("SKU一覧")} sku1=${pageHtml.includes("e2evar-4916-1")} sku2=${pageHtml.includes("e2evar-4916-6")}`);

    const ne = new NEConverter().convert([restored]);
    record("NE用CSVはSKUごとに行が分かれる（単品1+セット1）", ne.singles.length === 1 && ne.sets.length === 1 && ne.sets[0].set_syohin_code === "e2evar-4916-6" && ne.sets[0].suryo === "6",
      `singles=${ne.singles.length} sets=${ne.sets.length}`);
  } finally {
    const now = await listProducts(ssr as any);
    for (const p of now.filter((p) => String(p.ne_code).startsWith("e2evar-"))) await deleteProduct(ssr as any, p.id);
    const remain = (await listProducts(ssr as any)).filter((p) => String(p.ne_code).startsWith("e2evar-"));
    record("後片付け（テスト商品削除）", remain.length === 0, `remain=${remain.length}`);
  }

  finish();
})();
