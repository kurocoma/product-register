// 一括登録グリッドの DOM 実機E2E（Chromium 実ブラウザ + 実クリップボード + 実 Ctrl+V。モール送信なし）。
// ユニットテストでは担保できない「ブラウザが paste イベントをどのセル種別に発火させるか」を実証する:
//   A) 列方向貼り付け: text セルへの縦コピー展開 / 不足行の自動追加 / select セルへの paste 発火 /
//      クォート済みセル内タブの1列コピーが表取込へ誤ルートされない（classifyClipboard）/ 長文✎セル
//   B) 下方向コピー（↓）: prompt の既定値で最終行まで / 行数指定で途中まで / 不正入力は alert で中断
//   C) 統合カテゴリ読み込み（カテゴリ列グループ見出しの「📥 カテゴリ読み込み（属性・YahooID）」）:
//      読み込み→属性の項目・単位がグリッドの商品属性列（attribute_item_N 等）へ展開
//      （必須優先 top5・推奨単位プリフィル）→値を行内入力→他操作の後も値が残る→
//      一括保存で ProductInput.attributes として DB に永続化（後片付けつき）
// 使い方(webui): dev server を起動した状態で  npx tsx tests/e2e_bulk_paste_dom.ts
//   ベースURLは E2E_BASE（既定 http://localhost:3000）。Playwright は devDependencies に含まれる
//   （ブラウザ未取得なら npx playwright install chromium）。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";

(async () => {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
  const BASE = process.env.E2E_BASE || "http://localhost:3000";

  const { createClient } = await import("@supabase/supabase-js");
  const { createServerClient } = await import("@supabase/ssr");
  const { chromium } = await import("playwright");
  const { listProducts, deleteProduct, dbRowToProductInput } = await import("@/lib/product/repository");

  const results: { step: string; ok: boolean; detail?: string }[] = [];
  const record = (step: string, ok: boolean, detail = "") => {
    results.push({ step, ok, detail });
    console.log(`${ok ? "✅" : "❌"} ${step}${detail ? "  — " + detail : ""}`);
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
  record("セッション確立", jar.size > 0, `user=${user.email}`);

  // --- Chromium 起動（クリップボード権限つき）+ 認証 cookie 引き継ぎ ---
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: BASE })));
  const page = await context.newPage();

  // prompt / alert / confirm の応答キュー（fillDown の行数入力・不正入力 alert に応答する）
  const dialogQueue: { action: "accept" | "dismiss"; text?: string }[] = [];
  const dialogLog: string[] = [];
  page.on("dialog", (d) => {
    dialogLog.push(`${d.type()}:${d.message().slice(0, 30)}`);
    const next = dialogQueue.shift();
    void (next && next.action === "accept" ? d.accept(next.text) : d.dismiss());
  });

  const waitFor = async (cond: () => Promise<boolean>, ms = 10000): Promise<boolean> => {
    const deadline = Date.now() + ms;
    for (;;) {
      try { if (await cond()) return true; } catch { /* 再試行 */ }
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  /** 実クリップボード経由の貼り付け: writeText → セルへ focus → 実 Ctrl+V */
  const pasteInto = async (selector: string, text: string) => {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.focus(selector);
    await page.keyboard.press("Control+v");
  };
  const cell = (row: number, key: string) => `#bulkgrid-${row}-${key}`;
  const rowCount = () => page.locator("tbody tr").count();

  const NE = "e2edom-0006-1"; // C 章で保存するテスト商品（後片付けで削除）
  try {
    await page.goto(BASE + "/bulk-register", { waitUntil: "networkidle" });
    record("/bulk-register 描画（実ブラウザ・認証済み）", (await page.locator("h1").first().textContent()) === "一括登録（まとめて入力）");

    // ============ A) 列方向貼り付け ============
    // A1: text セルに縦3件 → そのセルから下方向へ展開（初期3行のまま）
    await pasteInto(cell(0, "catch_copy_pc"), "コピー1\r\nコピー2\r\nコピー3\r\n");
    const a1 = await waitFor(async () => (await page.inputValue(cell(2, "catch_copy_pc"))) === "コピー3");
    record("A1 text セルへの列貼り付け（3件が下方向へ展開）", a1 && (await page.inputValue(cell(0, "catch_copy_pc"))) === "コピー1" && (await rowCount()) === 3, `rows=${await rowCount()}`);

    // A2: 5件貼り付け → 不足2行が自動追加される
    await pasteInto(cell(0, "store_category"), "c1\r\nc2\r\nc3\r\nc4\r\nc5\r\n");
    const a2 = await waitFor(async () => (await rowCount()) === 5 && (await page.inputValue(cell(4, "store_category"))) === "c5");
    record("A2 不足行の自動追加（3行→5行）", a2, `rows=${await rowCount()}`);

    // A3: select セルへの列貼り付け（paste イベントが <select> にも発火することの実証）
    await pasteInto(cell(1, "shipping_type"), "送料無料\r\n送料無料\r\n");
    const a3 = await waitFor(async () => (await page.inputValue(cell(2, "shipping_type"))) === "送料無料");
    record("A3 select セルへの列貼り付け（送料区分 2〜3 行目 = 送料無料）", a3 && (await page.inputValue(cell(0, "shipping_type"))) === "送料別", `row1=${await page.inputValue(cell(1, "shipping_type"))}`);

    // A4: 減点C1の再現（実ブラウザ）: クォート済みセル内タブ入りの1列コピー → 列貼り付けへ正しくルート
    const tabHtml = "<p>\t<b>■ 商品の魅力</b></p>";
    await pasteInto(cell(0, "product_name"), `"${tabHtml}"\r\n`);
    const a4 = await waitFor(async () => (await page.inputValue(cell(0, "product_name"))) === tabHtml);
    record("A4 クォート内タブ入り1列コピーが列貼り付けにルート（商品名にタブ込みで入る）", a4, JSON.stringify(await page.inputValue(cell(0, "product_name"))).slice(0, 50));
    record("A4 表取込へ誤ルートしていない（NEコード列が汚れない・行数不変）", (await page.inputValue(cell(0, "ne_code"))) === "" && (await rowCount()) === 5, `ne_code="${await page.inputValue(cell(0, "ne_code"))}" rows=${await rowCount()}`);

    // A5: 長文✎セル（button）にもクォート済み複数行HTMLが1セル=1値で入る
    const html1 = '<!--text--><p><br><b>■ 商品の魅力</b></p>\n<p>沖縄限定の島レモネード。</p>';
    const html2 = '<p><b>■ 内容量</b></p>\n<p>500ml×24本</p>';
    await pasteInto(cell(0, "description_pc"), `"${html1}"\r\n"${html2}"\r\n`);
    const a5 = await waitFor(async () => ((await page.locator(cell(1, "description_pc")).textContent()) ?? "").includes("500ml×24本"));
    record("A5 長文✎セルへの列貼り付け（複数行HTML 2件が2行に1セル=1値で入る）", a5 && ((await page.locator(cell(0, "description_pc")).textContent()) ?? "").includes("■ 商品の魅力"));

    // ============ B) 下方向コピー（↓・行数指定 prompt） ============
    await page.goto(BASE + "/bulk-register", { waitUntil: "networkidle" }); // グリッドをリセット（3行）
    const fillDownBtn = (row: number, key: string) => page.locator(cell(row, key)).locator("xpath=../../button");

    // B1: 既定値のまま OK → 従来どおり最終行まで
    await page.fill(cell(0, "catch_copy_yahoo"), "夏を彩る！");
    dialogQueue.push({ action: "accept" }); // prompt 既定値（=最終行まで）
    await fillDownBtn(0, "catch_copy_yahoo").click();
    const b1 = await waitFor(async () => (await page.inputValue(cell(2, "catch_copy_yahoo"))) === "夏を彩る！");
    record("B1 ↓の既定値OKで最終行まで下方向コピー", b1 && (await page.inputValue(cell(1, "catch_copy_yahoo"))) === "夏を彩る！", dialogLog[dialogLog.length - 1]);

    // B2: 行数を「2」に指定 → 途中の行まで（5行に増やし、4〜5行目には入らない）
    await page.getByRole("button", { name: "+ 行を追加" }).click();
    await page.getByRole("button", { name: "+ 行を追加" }).click();
    await page.fill(cell(0, "keyword"), "限定");
    dialogQueue.push({ action: "accept", text: "2" });
    await fillDownBtn(0, "keyword").click();
    const b2 = await waitFor(async () => (await page.inputValue(cell(2, "keyword"))) === "限定");
    record("B2 行数指定「2」で 2〜3 行目まで（4行目以降は不変）", b2 && (await page.inputValue(cell(3, "keyword"))) === "" && (await page.inputValue(cell(4, "keyword"))) === "", `4行目="${await page.inputValue(cell(3, "keyword"))}"`);

    // B3: 不正入力（abc）→ alert で中断・値は変わらない / キャンセル → 何もしない
    await page.fill(cell(0, "product_name"), "検証中");
    dialogQueue.push({ action: "accept", text: "abc" }, { action: "accept" }); // prompt に abc → alert を OK
    await fillDownBtn(0, "product_name").click();
    await new Promise((r) => setTimeout(r, 400));
    const alerted = dialogLog[dialogLog.length - 1]?.startsWith("alert:");
    dialogQueue.push({ action: "dismiss" }); // キャンセル
    await fillDownBtn(0, "product_name").click();
    await new Promise((r) => setTimeout(r, 400));
    record("B3 不正入力は alert で中断・キャンセルは no-op（1行目の値のまま）", alerted && (await page.inputValue(cell(1, "product_name"))) === "", `dialogs=${dialogLog.slice(-3).join(" / ")}`);

    // ============ C) 統合カテゴリ読み込み → 属性がグリッドの商品属性列へ展開 → 値を行内入力 → 保存で永続化 ============
    await page.goto(BASE + "/bulk-register", { waitUntil: "networkidle" });
    // 前回失敗の残骸を削除
    for (const p of (await listProducts(ssr as any)).filter((p) => p.ne_code === NE)) await deleteProduct(ssr as any, p.id);
    // 単位候補（unit_choices）を持つ属性マスタからカテゴリIDを選ぶ（推奨単位プリフィルの実証込み）
    const { data: attrRows } = await (ssr as any).from("rakuten_genre_attributes").select("genre_id, item_name, unit_choices").neq("unit_choices", "").limit(1);
    const genreId: string = attrRows?.[0]?.genre_id != null ? String(attrRows[0].genre_id) : "";
    if (genreId === "") {
      record("C 章スキップ", true, "rakuten_genre_attributes に unit_choices 付きマスタが無いため（環境依存）");
    } else {
      // 期待値は実装と同じ純関数（attributesToColumns = 必須優先 top5・推奨単位プリフィル）で組む
      const { attributesToColumns } = await import("@/lib/product/category-assist");
      const { emptyGridRow } = await import("@/lib/product/grid-rows");
      const { data: genreAttrs } = await (ssr as any)
        .from("rakuten_genre_attributes")
        .select("item_name, requirement, recommended_unit, unit_choices, has_unit, sort_order")
        .eq("genre_id", genreId)
        .order("sort_order", { ascending: true });
      const expected = attributesToColumns((genreAttrs ?? []) as any, emptyGridRow()).columns as Record<string, string>;

      await page.fill(cell(0, "maker_code"), "e2edom");
      await page.fill(cell(0, "jan_code"), "4514603470006");
      await page.fill(cell(0, "product_name"), "E2E DOM貼り付け検証商品");
      await page.fill(cell(0, "selling_price"), "100");
      await page.fill(cell(0, "mall_category_id"), genreId);
      // カテゴリ列グループ見出しの統合ボタン（旧パネルは廃止）
      await page.getByRole("button", { name: /カテゴリ読み込み（属性・YahooID）/ }).click();

      // C1: 属性の項目が右パネルではなくグリッドの商品属性列（attribute_item_N）へ展開される
      const c1 = await waitFor(
        async () => expected.attribute_item_1 !== "" && (await page.inputValue(cell(0, "attribute_item_1"))) === expected.attribute_item_1,
        15000,
      );
      record("C1 読み込みで属性の項目がグリッドの商品属性列に入る", c1, `genre=${genreId} item1=${await page.inputValue(cell(0, "attribute_item_1"))}`);

      // C2: 単位列に楽天推奨単位がプリフィルされる（5枠すべて attributesToColumns の期待値どおり）
      let unitsOk = true;
      const unitDetail: string[] = [];
      for (let n = 1; n <= 5; n++) {
        const got = await page.inputValue(cell(0, `attribute_unit_${n}`));
        const want = expected[`attribute_unit_${n}`] ?? "";
        if (got !== want) unitsOk = false;
        if (got !== "" || want !== "") unitDetail.push(`${n}:${got || "(空)"}${got === want ? "" : `≠${want}`}`);
      }
      record("C2 単位列に推奨単位がプリフィルされる（5枠が期待どおり）", unitsOk, unitDetail.join(" ") || "単位なしジャンル");

      // C3: 値はグリッドの行内で入力 → 他のセル・行を操作しても値が残る（行の state に保持されている）
      await page.fill(cell(0, "attribute_value_1"), "DOMテスト値7");
      await page.focus(cell(1, "product_name")); // 別の行のセルへフォーカス移動
      await page.focus(cell(0, "ne_code")); // 元の行へ戻る
      const c3 = await waitFor(async () => (await page.inputValue(cell(0, "attribute_value_1"))) === "DOMテスト値7");
      record("C3 行内で入力した属性値が他セル操作後も残る", c3);

      // 一括保存 → DB の extra.attributes に入る（ProductInput.attributes として復元できる）
      await page.getByRole("button", { name: /一括保存/ }).click();
      const c4 = await waitFor(async () => ((await page.locator("text=保存結果").count()) > 0), 20000);
      const summaryText = (await page.locator("text=保存結果").first().textContent()) ?? "";
      record("C4 一括保存が成功（画面の保存結果）", c4 && summaryText.includes("成功 1 商品"), summaryText.trim());
      const saved = (await listProducts(ssr as any)).find((p) => p.ne_code === NE);
      const attrs = saved ? dbRowToProductInput(saved as any).attributes ?? [] : [];
      const hit = attrs.find((a: any) => a.value === "DOMテスト値7" && a.item === expected.attribute_item_1);
      record("C5 商品属性列で入力した値が DB に永続化（attributes に項目・値が残る）", !!saved && !!hit, saved ? `item=${hit?.item ?? "?"} attrs=${attrs.length}件` : "商品が見つからない");
    }
  } finally {
    // --- 後片付け（テスト商品削除 → ブラウザ終了） ---
    const now = await listProducts(ssr as any);
    for (const p of now.filter((p) => p.ne_code === NE)) await deleteProduct(ssr as any, p.id);
    const remain = (await listProducts(ssr as any)).filter((p) => p.ne_code === NE);
    record("後片付け（テスト商品削除）", remain.length === 0, `remain=${remain.length}`);
    await browser.close();
  }

  const ng = results.filter((r) => !r.ok).length;
  console.log(`\n=== ${results.length - ng}/${results.length} passed ===`);
  process.exit(ng > 0 ? 1 : 0);
})();
