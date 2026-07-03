// 一括登録グリッド「テンプレートDL → Excel貼り付け → 保存」の実機E2E（モール送信なし・products DB まで）。
//   1) /bulk-register の SSR に テンプレートDLボタン・拡張列見出し・列グループ見出しが現れるか
//   2) buildTemplateCsv() のテンプレを Excel コピー（TSV）に見立てて parseTsv → 全項目が row に入るか
//   3) その行を保存(upsertProduct) → DB から読み戻して拡張列（説明文・Yahooカテゴリ等）が残るか → 後片付け
// 使い方(webui): dev server を起動した状態で  npx tsx tests/e2e_bulk_template.ts
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
  const { ALL_GRID_COLUMNS, buildTemplateCsv, parseTsv, applyFieldChange, validateGridRows, gridRowToProductInput } =
    await import("@/lib/product/grid-rows");
  const { upsertProduct, deleteProduct, listProducts, dbRowToProductInput } = await import("@/lib/product/repository");

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

  // --- 1) /bulk-register の SSR: テンプレートDLボタン + 拡張列見出し + 列グループ見出し ---
  {
    const res = await fetch(BASE + "/bulk-register", { redirect: "manual", headers: { Cookie: cookie } });
    const html = await res.text();
    record("SSR /bulk-register", res.status === 200, `HTTP ${res.status}`);
    record("テンプレートDLボタンの描画", html.includes("テンプレートDL"), "「テンプレートDL（CSV）」");
    const newHeads = ["PC用販売説明文", "商品説明PC", "商品説明スマホ", "検索キーワード", "メーカー名", "ブランド名", "YahooカテゴリID", "Yahooストアカテゴリパス", "単位"];
    const missing = newHeads.filter((h) => !html.includes(h));
    record("拡張9列の見出し描画", missing.length === 0, missing.length ? `不足: ${missing.join(",")}` : "9列OK");
    const groups = ["基本情報", "価格", "配送", "カテゴリ", "商品説明", "Yahoo"];
    const gMissing = groups.filter((g) => !html.includes(g));
    record("列グループ見出しの描画", gMissing.length === 0, gMissing.length ? `不足: ${gMissing.join(",")}` : "6グループOK");
  }

  // --- 2) テンプレ → TSV貼り付け → row（全項目往復） ---
  const csv = buildTemplateCsv();
  record("テンプレCSVはBOM付き", csv.charCodeAt(0) === 0xfeff, `先頭=U+${csv.charCodeAt(0).toString(16).toUpperCase()}`);
  const data = (Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: true }).data ?? []);
  const toTsvLine = (cells: string[]) => cells.map((c) => (/[\t\n\r"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join("\t");
  const rows = parseTsv(data.map(toTsvLine).join("\r\n"));
  record("テンプレ貼り付けで1行取込", rows.length === 1, `rows=${rows.length}`);
  const lost = ALL_GRID_COLUMNS.filter((c, i) => rows[0]?.[c.key] !== data[1]?.[i]).map((c) => c.label);
  record("全27項目が row に往復", lost.length === 0, lost.length ? `欠落: ${lost.join(",")}` : "27列OK");

  // --- 3) 保存 → 読み戻し → 拡張列が残る → 後片付け ---
  // 実データの ne_code と衝突しないよう、メーカーコードを e2etpl に変えて NEコードを自動再生成させる
  let row = applyFieldChange(rows[0], "maker_code", "e2etpl");
  row = applyFieldChange(row, "ne_code", ""); // 空に戻す → 自動追従が再開して e2etpl-4916-1 を生成
  record("NEコード再生成", row.ne_code === "e2etpl-4916-1", `ne_code=${row.ne_code}`);

  const createdIds: string[] = [];
  try {
    const before = await listProducts(ssr as any);
    for (const p of before.filter((p) => String(p.ne_code).startsWith("e2etpl-"))) await deleteProduct(ssr as any, p.id);

    const validation = validateGridRows([row]);
    record("テンプレ行は検証エラーなし", validation.size === 0, validation.size ? JSON.stringify([...validation.entries()]) : "OK");

    const saved = await upsertProduct(ssr as any, gridRowToProductInput(row));
    createdIds.push(saved.id);
    record("保存(insert)", !!saved.id, `id=${saved.id.slice(0, 8)}`);

    const after = await listProducts(ssr as any);
    const dbRow = after.find((p) => p.id === saved.id);
    const restored = dbRow ? dbRowToProductInput(dbRow as any) : null;
    record("一覧から読み戻し", !!restored, restored ? `ne_code=${restored.ne_code}` : "not found");
    if (restored) {
      const checks: [string, unknown, unknown][] = [
        ["description_pc", restored.description_pc, "<p>シークヮーサー果汁入り。沖縄限定の島レモネードです。</p>"],
        ["description_sp", restored.description_sp, "シークヮーサー果汁入り。沖縄限定の島レモネードです。"],
        ["sale_description_pc(extra往復)", restored.sale_description_pc, "<p>沖縄限定の島レモネード。まとめ買いがお得です。</p>"],
        ["keyword(extra往復)", restored.keyword, "レモネード 沖縄 バヤリース"],
        ["maker_name(extra往復)", restored.maker_name, "沖縄バヤリース"],
        ["brand_name(extra往復)", restored.brand_name, "バヤリース"],
        ["yahoo_category_id", restored.yahoo_category_id, "13457"],
        ["yahoo_path", restored.yahoo_path, "食品、飲料、製菓＞ソフトドリンク、ジュース"],
        ["unit", restored.unit, "本"],
        ["store_category", restored.store_category, "フルーツ・ソフトドリンク・酢"],
      ];
      const ng = checks.filter(([, a, b]) => a !== b);
      record("拡張列がDB往復で残る", ng.length === 0, ng.length ? ng.map(([k, a]) => `${k}=${JSON.stringify(a)}`).join(" / ") : `${checks.length}項目OK`);
    }

    // 再保存（savedId 指定）は更新になり重複しない
    const updated = await upsertProduct(ssr as any, gridRowToProductInput(applyFieldChange(row, "selling_price", "250")), saved.id);
    const again = await listProducts(ssr as any);
    record("再保存は更新（重複なし・価格反映）", again.filter((p) => String(p.ne_code).startsWith("e2etpl-")).length === 1 && Number(updated.selling_price) === 250, `selling=${updated.selling_price}`);
  } finally {
    const now = await listProducts(ssr as any);
    for (const p of now.filter((p) => String(p.ne_code).startsWith("e2etpl-"))) await deleteProduct(ssr as any, p.id);
    const remain = (await listProducts(ssr as any)).filter((p) => String(p.ne_code).startsWith("e2etpl-"));
    record("後片付け（テスト商品削除）", remain.length === 0, `remain=${remain.length}`);
  }

  finish();
})();
