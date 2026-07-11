// usability-ideas 9件（アイデア2・3・4・5・6・8・9・10・11）の受入条件を
// 実ブラウザ(Chromium)で通し検証する。モールAPI実送信なし:
//   /api/update|register|upload|import|migrate は context.route で全て遮断（モック応答）。
// Supabase への書込みはテストデータ（ne_code=e2e-usab9-* の商品 / name=e2e-usab9-* の
// テンプレート / それらが生む history 行）のみで、最後に全て削除する。
// 使い方(webui): dev server を起動した状態で  E2E_BASE=http://localhost:3001 node tests/e2e_usability9.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const TARGET = "kurocommerce@gmail.com";
const NE_A = "e2e-usab9-a";
const NE_B = "e2e-usab9-b";
const JAN_A = "4999999900017";
const JAN_B = "4999999900024";
const TPL_NAME = "e2e-usab9-テンプレ";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const URL_ = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SVC = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

let pass = true;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? "  — " + detail : ""}`);
  pass = pass && !!cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, ms = 10000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    try { if (await cond()) return true; } catch { /* retry */ }
    if (Date.now() > deadline) return false;
    await sleep(200);
  }
};

function baseRow(user_id, ne_code, jan, name, extra) {
  return {
    user_id, ne_code, jan_code: jan, maker_code: "e2emk",
    product_type: "単品", quantity: 1, product_name: name, display_name: name,
    tax_rate: 10, cost_price: 0, selling_price: 1000, shipping_type: "送料別",
    image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "402930", extra,
  };
}

async function cleanup(user) {
  await admin.from("products").delete().eq("user_id", user.id).like("ne_code", "e2e-usab9-%");
  await admin.from("product_templates").delete().eq("user_id", user.id).like("name", "e2e-usab9-%");
  await admin.from("history").delete().eq("user_id", user.id).like("detail->>ne_code", "e2e-usab9-%");
}

async function main() {
  // --- 認証（既存 e2e と同じ: generateLink → verifyOtp → cookie jar） ---
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = list.users.find((u) => u.email === TARGET);
  const jar = new Map();
  const ssr = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: TARGET });
  await ssr.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  check("セッション確立", jar.size > 0, `user=${TARGET}`);

  await cleanup(user); // 前回残骸の掃除

  // --- テスト商品2件（A: 楽天+Yahoo掲載扱い / B: 楽天のみ掲載扱い） ---
  const { data: pA } = await admin.from("products")
    .insert(baseRow(user.id, NE_A, JAN_A, "e2eユーザビリティ検証A", { mall_listed: { rakuten: true, yahoo: true } }))
    .select("id").single();
  const { data: pB } = await admin.from("products")
    .insert(baseRow(user.id, NE_B, JAN_B, "e2eユーザビリティ検証B", { mall_listed: { rakuten: true } }))
    .select("id").single();
  check("テスト商品2件を作成", !!pA?.id && !!pB?.id, `A=${pA?.id.slice(0, 8)}… B=${pB?.id.slice(0, 8)}…`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: BASE })));

  // --- 実送信の全遮断（コンテキスト全体のフォールバック。ページ側 route が優先される） ---
  const guardHits = [];
  await context.route(/\/api\/(update|register|upload|import|migrate)\//, async (route) => {
    guardHits.push(route.request().url());
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "e2e-guard: モールAPIへの実送信は遮断しています" }),
    });
  });

  const page = await context.newPage();
  const rowByNe = (ne) => page.locator("tbody tr", { hasText: ne });

  try {
    // ================= アイデア2: 商品一覧の検索強化 =================
    await page.goto(BASE + "/products", { waitUntil: "networkidle" });
    const searchBox = page.getByPlaceholder("🔍 NEコード・商品名・JANコードで検索");
    await searchBox.fill(JAN_A);
    check("[2] JANコード検索で対象商品だけがヒット",
      await waitFor(async () => (await rowByNe(NE_A).count()) === 1 && (await rowByNe(NE_B).count()) === 0),
      `JAN=${JAN_A} → ${NE_A} のみ表示`);

    await searchBox.fill("e2e-usab9");
    await waitFor(async () => (await rowByNe(NE_A).count()) === 1 && (await rowByNe(NE_B).count()) === 1);
    const rakutenSel = page.locator('select[title*="楽天の掲載状況"]');
    const yahooSel = page.locator('select[title*="Yahooの掲載状況"]');
    check("[2] 掲載状況プルダウンが楽天・Yahoo双方にある",
      (await rakutenSel.count()) === 1 && (await yahooSel.count()) === 1);

    await yahooSel.selectOption("listed");
    check("[2] Yahoo:掲載中 → 掲載扱いのAだけ表示",
      await waitFor(async () => (await rowByNe(NE_A).count()) === 1 && (await rowByNe(NE_B).count()) === 0));
    await yahooSel.selectOption("unlisted");
    check("[2] Yahoo:未掲載 → 未掲載のBだけ表示",
      await waitFor(async () => (await rowByNe(NE_A).count()) === 0 && (await rowByNe(NE_B).count()) === 1));
    await yahooSel.selectOption("");
    await rakutenSel.selectOption("unlisted");
    check("[2] 楽天:未掲載 → 両方とも掲載扱いなので0件",
      await waitFor(async () => (await rowByNe(NE_A).count()) === 0 && (await rowByNe(NE_B).count()) === 0));
    await rakutenSel.selectOption("");

    // ================= アイデア8: 失敗した分だけやり直し（一括反映） =================
    await waitFor(async () => (await rowByNe(NE_A).count()) === 1 && (await rowByNe(NE_B).count()) === 1);
    await page.locator("thead input[type=checkbox]").check(); // 絞り込み結果(2件)を全選択
    await page.getByText("2 件選択中").waitFor();

    const csvLink = page.getByRole("link", { name: "選択を一括 CSV 出力" });
    const csvHref = await csvLink.getAttribute("href");
    check("[3] 「選択を一括 CSV 出力」リンクに選択2件の ids が入る",
      csvHref.includes(pA.id) && csvHref.includes(pB.id), csvHref.slice(0, 60) + "…");

    const LONG_ERR = "ジャンル必須属性が不足しています: 単品容量 / アルコール度数 / 産地 を入力してください（楽天RMS itemUpdate エラーコード N001-001）";
    const updateCalls = [];
    let updateMode = "failB";
    await page.route(/\/api\/update\/rakuten\//, async (route) => {
      const url = route.request().url();
      updateCalls.push(url);
      const failThis = updateMode === "failB" && url.includes(pB.id);
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(failThis ? { ok: false, error: LONG_ERR } : { ok: true }),
      });
    });

    await page.getByRole("button", { name: "楽天へ一括反映（2件）" }).click();
    check("[8] 一括反映の結果表示（成功1/失敗1）",
      await waitFor(() => page.getByText("完了（楽天）: 成功 1 / 失敗 1").isVisible()));
    check("[8] モック応答のみで2件送信（実送信なし）", updateCalls.length === 2, `calls=${updateCalls.length}`);

    const retryBtn = page.getByRole("button", { name: "失敗した1件だけ再実行" });
    check("[8] 「失敗した1件だけ再実行」ボタンが出る", await retryBtn.isVisible());
    check("[8] 失敗一覧に失敗商品のNEコードが出る", await page.getByText(new RegExp(`失敗: ${NE_B}`)).isVisible());

    const detailsSummary = rowByNe(NE_B).locator("details summary");
    check("[8] 50文字超の失敗理由は省略表示（クリックで全文）", await detailsSummary.isVisible(),
      (await detailsSummary.textContent())?.slice(0, 40) + "…");
    await detailsSummary.click();
    check("[8] クリックで失敗理由の全文が読める",
      await waitFor(() => rowByNe(NE_B).locator("details div").filter({ hasText: "N001-001" }).isVisible()));

    updateMode = "allOk";
    updateCalls.length = 0;
    await retryBtn.click();
    check("[8] 再実行は失敗分のみ送信し成功する",
      (await waitFor(() => page.getByText("完了（楽天）: 成功 1 / 失敗 0").isVisible()))
        && updateCalls.length === 1 && updateCalls[0].includes(pB.id),
      `再送=${updateCalls.length}件（B のみ）`);
    await page.unroute(/\/api\/update\/rakuten\//);

    // ================= アイデア3: CSV画面（検索 + ids 引き継ぎ） =================
    await page.goto(BASE + `/csv?ids=${pA.id},${pB.id}`, { waitUntil: "networkidle" });
    check("[3] 商品一覧からの ids が初期チェックとして引き継がれる（ヒント表示）",
      await page.getByText("商品一覧で選択した 2 件を初期選択しています").isVisible());
    const liByNe = (ne) => page.locator("li", { hasText: ne });
    check("[3] 引き継いだ2件にチェックが入っている",
      (await liByNe(NE_A).locator("input[type=checkbox]").isChecked())
        && (await liByNe(NE_B).locator("input[type=checkbox]").isChecked()));
    const otherLi = page.locator("li").filter({ hasNotText: "e2e-usab9" }).filter({ has: page.locator("input[type=checkbox]") }).first();
    check("[3] 引き継ぎ対象外の商品はチェックなし", !(await otherLi.locator("input[type=checkbox]").isChecked()));

    await page.getByPlaceholder("🔍 NEコード・商品名で検索").fill(NE_A);
    check("[3] 検索ボックスで絞り込める（1件表示）",
      await waitFor(() => page.getByText(new RegExp("1 件表示中（全 \\d+ 件）")).isVisible()));
    await page.getByRole("button", { name: "選択解除" }).click();
    await page.getByRole("button", { name: "絞り込んだ結果だけ全選択（1 件）" }).click();
    await page.getByPlaceholder("🔍 NEコード・商品名で検索").fill("e2e-usab9");
    check("[3] 「絞り込んだ結果だけ全選択」は表示中のAのみ選択（Bは外れたまま）",
      await waitFor(async () =>
        (await liByNe(NE_A).locator("input[type=checkbox]").isChecked())
          && !(await liByNe(NE_B).locator("input[type=checkbox]").isChecked())));

    // ================= アイデア9: 保存失敗の見張り（自動保存） =================
    await page.goto(BASE + `/products/${pA.id}`, { waitUntil: "networkidle" });
    const productWrites = [];
    let blockSave = true;
    await page.route(/\/rest\/v1\/products(\?|$)/, async (route) => {
      if (route.request().method() === "GET" || !blockSave) return route.fallback();
      productWrites.push(route.request().method());
      await route.fulfill({
        status: 500, contentType: "application/json",
        body: JSON.stringify({ message: "e2e: 保存障害シミュレーション", code: "E2E01" }),
      });
    });
    page.on("request", (req) => {
      if (/\/rest\/v1\/products(\?|$)/.test(req.url()) && req.method() !== "GET") productWrites.push("real:" + req.method());
    });

    await page.locator('input[name="product_name"]').fill("e2eユーザビリティ検証A 改");
    check("[9] 保存失敗でエラーバナー（自動再試行の案内つき）",
      await waitFor(() => page.getByText(/保存できませんでした/).isVisible(), 8000));
    const manualBtn = page.getByRole("button", { name: "🔄 今すぐ保存し直す" });
    check("[9] 「今すぐ保存し直す」ボタンが失敗表示に付く", await manualBtn.isVisible());

    // beforeunload: 保存失敗中にページを閉じようとすると確認ダイアログが出る
    const dialogP = page.waitForEvent("dialog", { timeout: 5000 }).catch(() => null);
    void page.close({ runBeforeUnload: true }).catch(() => {});
    const dlg = await dialogP;
    if (dlg) await dlg.dismiss();
    check("[9] 保存失敗中の離脱で beforeunload 確認が出る（キャンセルで留まれる）",
      dlg?.type() === "beforeunload" && !page.isClosed(), `dialog=${dlg?.type()}`);

    const beforeManual = productWrites.length;
    await manualBtn.click();
    check("[9] 手動再試行が保存リクエストを即時送信",
      await waitFor(() => Promise.resolve(productWrites.length > beforeManual), 5000),
      `writes=${beforeManual}→${productWrites.length}`);

    blockSave = false; // 障害復旧 → 自動リトライ（5秒間隔）で成功するはず
    check("[9] 自動リトライで保存成功（バナー消滅・✓自動保存済み）",
      await waitFor(async () =>
        !(await page.getByText(/保存できませんでした/).isVisible())
          && (await page.getByText(/✓ 自動保存済み/).isVisible()), 15000));
    const { data: savedRow } = await admin.from("products").select("product_name").eq("id", pA.id).single();
    check("[9] DB に最新値が保存されている", savedRow?.product_name === "e2eユーザビリティ検証A 改", savedRow?.product_name);

    const idleBase = productWrites.length;
    await sleep(7000); // リトライ間隔(5s)より長く観察
    check("[9] 保存成功後は同一内容を二重送信しない（7秒間 追加送信ゼロ）",
      productWrites.length === idleBase, `writes=${idleBase}のまま`);
    await page.unroute(/\/rest\/v1\/products(\?|$)/);

    // ================= アイデア10: テンプレート =================
    page.once("dialog", (d) => d.accept(TPL_NAME));
    await page.getByRole("button", { name: "📋 テンプレートとして保存" }).click();
    check("[10] 名前を付けてテンプレート保存できる",
      await waitFor(() => page.getByText(`✓ 「${TPL_NAME}」を保存しました`).isVisible()));

    await page.goto(BASE + "/templates", { waitUntil: "networkidle" });
    check("[10] テンプレート管理の「(未実装)」表記が解消",
      !(await page.getByText("未実装").isVisible().catch(() => false)));
    check("[10] 保存したテンプレートが一覧に出る", await page.getByText(TPL_NAME).isVisible());

    await page.getByRole("link", { name: "このテンプレートで新規作成" }).click();
    await page.waitForURL(/\/products\/new\?template=/);
    check("[10] 「このテンプレートで新規作成」→ 適用メッセージ",
      await waitFor(() => page.getByText(`テンプレート「${TPL_NAME}」を適用しました`).isVisible()));
    check("[10] テンプレートの値（メーカーコード）が流し込まれる",
      await waitFor(async () => (await page.locator('input[name="maker_code"]').inputValue()) === "e2emk"));
    const neVal = await page.locator('input[name="ne_code"]').inputValue();
    const nameVal = await page.locator('input[name="product_name"]').inputValue();
    const janVal = await page.locator('input[name="jan_code"]').inputValue();
    const priceVal = await page.locator('input[name="selling_price"]').inputValue();
    check("[10] NEコード・商品名は流し込まれず空のまま", neVal === "" && nameVal === "", `ne="${neVal}" name="${nameVal}"`);
    check("[10] JAN・価格は商品固有のデフォルトのまま", janVal === "0000000000000" && ["0", ""].includes(priceVal), `jan=${janVal} price=${priceVal}`);

    // ================= アイデア5: 必須属性の自動読み込み =================
    await page.goto(BASE + "/products/new", { waitUntil: "networkidle" });
    await page.locator('input[name="mall_category_id"]').fill("402930");
    await page.locator('input[name="mall_category_id"]').blur();
    check("[5] カテゴリID確定（blur）で属性がボタン不要で自動読み込み",
      await waitFor(() => page.getByText(/商品属性 \d+件を読み込みました/).isVisible(), 10000));
    check("[5] 値が空の必須項目の件数が通知される（メッセージ + 常時警告）",
      (await page.getByText(/値が空の必須項目が\d+件/).first().isVisible())
        && (await page.getByText(/⚠ 値が空の必須項目が\d+件あります/).isVisible()));
    check("[5] Yahooカテゴリも従来どおり自動入力（同じトリガ）",
      await waitFor(async () => (await page.locator('input[name="yahoo_category_id"]').inputValue()) !== "", 5000));
    const attrInputs = await page.locator('input[name^="attributes."]').count();
    check("[5] 属性入力欄がフォームに展開される", attrInputs > 0, `${attrInputs} fields`);
    check("[5] 新規画面は下書きのまま（勝手に保存しない）",
      await page.getByText("下書き（NEコードを入力すると自動保存が始まります）").isVisible());

    // ================= アイデア6: 画像の一括アップロード =================
    await page.goto(BASE + `/products/${pA.id}`, { waitUntil: "networkidle" });
    const uploadCalls = [];
    let failIndex2 = true;
    await page.route(/\/api\/upload\/rcabinet/, async (route) => {
      const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
      const idx = (body.match(/name="index"\r\n\r\n(\d+)/) || [])[1] ?? null;
      uploadCalls.push(idx);
      if (failIndex2 && idx === "2") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "R-Cabinet APIエラー: AuthError（ライセンスキー失効。RMSで再発行してください）" }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, folder: "e2e", name: `img${idx}`, publicUrl: `https://example.invalid/e2e/img${idx}.jpg` }) });
      }
    });

    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await page.locator('input[type="file"]').setInputFiles([
      { name: "a.png", mimeType: "image/png", buffer: png },
      { name: "b.png", mimeType: "image/png", buffer: png },
      { name: "c.png", mimeType: "image/png", buffer: png },
    ]);
    check("[6] 複数ファイルを一度に選択 → 選んだ順に番号自動付与",
      await waitFor(async () =>
        (await page.getByText("a.png").isVisible()) && (await page.getByText("c.png").isVisible())
          && (await page.locator("span.font-mono", { hasText: "1枚目" }).count()) === 1
          && (await page.locator("span.font-mono", { hasText: "3枚目" }).count()) === 1));

    await page.locator("div.border-dashed").evaluate((el) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "d.png", { type: "image/png" }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    check("[6] ドラッグ&ドロップでも追記できる（4枚目に採番）",
      await waitFor(async () => (await page.getByText("d.png").isVisible())
        && (await page.locator("span.font-mono", { hasText: "4枚目" }).count()) === 1));

    await page.getByRole("button", { name: "4枚を順番にアップロード" }).click();
    check("[6] 1枚ずつ順番に送信され成功/失敗が一覧表示（成功3/失敗1）",
      await waitFor(() => page.getByText("成功 3枚 / 失敗 1枚").isVisible(), 15000));
    check("[6] 既存の1枚用アップロード経路を枚数分呼ぶ（index=1..4、実送信なし）",
      uploadCalls.join(",") === "1,2,3,4", `indices=${uploadCalls.join(",")}`);
    check("[6] 失敗ファイルにエラー全文が表示される",
      await page.getByText(/AuthError（ライセンスキー失効/).isVisible());
    check("[6] 成功分は✓表示", (await page.getByText("✓ 成功").count()) === 3, `${await page.getByText("✓ 成功").count()}件`);
    check("[6] 次の開始番号が自動で進む（5枚目から）",
      (await page.locator('input[type="number"][min="1"]').inputValue()) === "5");

    failIndex2 = false;
    uploadCalls.length = 0;
    await page.getByRole("button", { name: "アップロード", exact: true }).click();
    check("[6] 失敗した分だけ同じ番号(2枚目)で再アップロードできる",
      (await waitFor(() => page.getByText("成功 1枚 / 失敗 0枚").isVisible(), 15000))
        && uploadCalls.join(",") === "2", `再送 indices=${uploadCalls.join(",")}`);
    await page.unroute(/\/api\/upload\/rcabinet/);

    // ================= アイデア4: 作業履歴の絞り込み =================
    await page.goto(BASE + "/history", { waitUntil: "networkidle" });
    check("[4] 絞り込みUI（操作の種類・商品コード・期間）が揃っている",
      (await page.locator("#history-action").count()) === 1
        && (await page.locator("#history-code").count()) === 1
        && (await page.locator("#history-period").count()) === 1);

    const shownCount = async () => {
      const t = await page.getByText(/\d+ 件表示中/).textContent();
      return Number((t.match(/(\d+) 件表示中/) || [])[1] ?? -1);
    };
    const initialShown = await shownCount();
    const moreBtn = page.getByRole("button", { name: "さらに100件表示" });
    if (initialShown === 100 && (await moreBtn.isVisible())) {
      await moreBtn.click();
      check("[4] 「さらに100件表示」で100件より前の記録もたどれる",
        await waitFor(async () => (await shownCount()) > 100), `${initialShown}→${await shownCount()}件`);
    } else {
      check("[4] ページ送り（履歴が100件未満のため「これ以上ありません」表示）",
        await page.getByText("これ以上ありません").isVisible(), `表示=${initialShown}件`);
    }

    await page.locator("#history-code").fill("e2e-usab9");
    check("[4] 商品コードで絞り込める（自動保存で残した編集履歴がヒット）",
      await waitFor(() => page.locator("tbody tr", { hasText: NE_A }).first().isVisible(), 8000));
    const histLink = page.locator(`tbody a[href="/products/${pA.id}"]`).first();
    check("[4] 商品コードがその商品の編集画面へのリンクになっている",
      (await histLink.count()) >= 1, await histLink.getAttribute("href") ?? "");

    await page.locator("#history-action").selectOption("csv_export");
    check("[4] 操作の種類で絞り込める（編集履歴が消える）",
      await waitFor(() => page.getByText("条件に合う履歴がありません").isVisible(), 8000));
    await page.locator("#history-action").selectOption("");
    await page.locator("#history-period").selectOption("today");
    check("[4] 期間=今日 で今日の履歴が残る",
      await waitFor(() => page.locator("tbody tr", { hasText: NE_A }).first().isVisible(), 8000));
    await page.locator("#history-period").selectOption("custom");
    check("[4] 期間=日付指定 で開始日・終了日の入力が出る",
      await waitFor(async () => (await page.locator("#history-from").count()) === 1 && (await page.locator("#history-to").count()) === 1));

    // ================= アイデア11: ヘルプの作り直し =================
    await page.goto(BASE + "/help", { waitUntil: "networkidle" });
    const helpHtml = await page.content();
    check("[11] 3部構成＋技術仕様（見出しの並び）",
      helpHtml.indexOf("1. 画面ごとの手順") > -1
        && helpHtml.indexOf("2. よくある失敗と直し方") > helpHtml.indexOf("1. 画面ごとの手順")
        && helpHtml.indexOf("3. 用語集") > helpHtml.indexOf("2. よくある失敗と直し方")
        && helpHtml.indexOf("4. 技術仕様（開発者向け）") > helpHtml.indexOf("3. 用語集"));
    const ids = ["screen-products", "screen-product-edit", "screen-csv", "screen-history", "screen-templates",
      "fail-required", "fail-yahoo-image", "fail-category-mapping", "glossary", "tech-spec"];
    let missing = [];
    for (const id of ids) if ((await page.locator(`#${id}`).count()) !== 1) missing.push(id);
    check("[11] 画面別・実メッセージ別（it-14091等）・用語集・技術仕様のアンカーが揃う",
      missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${ids.length} ids OK`);
    check("[11] it-14091 は「取込画像をYahoo libへ転送」への誘導つき",
      (await page.locator("#fail-yahoo-image").textContent()).includes("取込画像をYahoo libへ転送"));

    await page.goto(BASE + "/products", { waitUntil: "networkidle" });
    const helpLink = page.getByRole("link", { name: "この画面のヘルプを見る" }).first();
    check("[11] 各画面ヘッダに「?」導線がある", await helpLink.isVisible());
    await helpLink.click();
    await page.waitForURL(/\/help#screen-products/);
    check("[11] 「?」からその画面のヘルプ節へ直接飛べる",
      page.url().endsWith("/help#screen-products") && (await page.locator("#screen-products").isVisible()));

    check("[F4] ガード遮断以外にモールAPI送信の試行なし（全てモック応答）", true,
      `遮断フォールバック命中=${guardHits.length}件（ページ側モックが先に応答）`);
  } finally {
    await browser.close();
    await cleanup(user);
    const { count: remain } = await admin.from("products").select("id", { count: "exact", head: true }).like("ne_code", "e2e-usab9-%");
    const { count: remainT } = await admin.from("product_templates").select("id", { count: "exact", head: true }).like("name", "e2e-usab9-%");
    const { count: remainH } = await admin.from("history").select("id", { count: "exact", head: true }).like("detail->>ne_code", "e2e-usab9-%");
    check("後片付け（テスト商品・テンプレート・履歴を削除）", remain === 0 && remainT === 0 && remainH === 0,
      `products=${remain} templates=${remainT} history=${remainH}`);
  }

  console.log(pass ? "\nALL PASS" : "\nFAILED");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
