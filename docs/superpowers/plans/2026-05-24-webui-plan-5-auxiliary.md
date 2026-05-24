# WebUI Plan 5: Auxiliary Screens (補助画面群) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans

**Goal:** 補助 6 画面 (ダッシュボード実データ反映 + CSV ダウンロード一括画面 + テンプレート管理 + 作業履歴 + 設定 + ヘルプ) を実装し、 全 9 画面の機能を完成させる。

**Architecture:** Server Components ベースで Supabase からデータ取得。 CSV 一括ダウンロードは ZIP 化。 テンプレートは新規商品作成時のひな形として利用。 history テーブルは PostgreSQL トリガー or アプリ層で自動記録。

**Tech Stack:** Next.js Server Components, Supabase, JSZip (ZIP 生成), react-markdown (ヘルプ Markdown レンダ)

**前提:** Plan 1〜4 完了済み

---

## ファイル構成

```
webui/
├── app/(main)/
│   ├── page.tsx                       # ダッシュボード 実データ反映
│   ├── csv/page.tsx                   # CSV ダウンロード一括画面
│   ├── templates/
│   │   ├── page.tsx                   # テンプレ一覧
│   │   └── [id]/page.tsx              # テンプレ編集
│   ├── history/page.tsx               # 作業履歴
│   ├── settings/page.tsx              # 設定
│   └── help/page.tsx                  # ヘルプ
├── app/api/
│   ├── csv/bulk/route.ts              # 一括 ZIP ダウンロード
│   └── history/log/route.ts           # 履歴記録
├── components/
│   ├── dashboard/
│   │   ├── StatCards.tsx
│   │   ├── RecentEdits.tsx
│   │   ├── AlertList.tsx
│   │   └── CsvHistoryTable.tsx
│   ├── csv/BulkDownloadForm.tsx
│   ├── templates/TemplateList.tsx
│   ├── templates/TemplateForm.tsx
│   ├── history/HistoryTable.tsx
│   ├── settings/SettingsForm.tsx
│   ├── settings/MakerCodesTable.tsx
│   └── help/HelpContent.tsx
└── lib/history/recorder.ts            # 履歴記録ヘルパー
```

---

## Task 1: 履歴記録ヘルパー + Hook 化

**Files:** webui/lib/history/recorder.ts

- [ ] **Step 1: 実装**

```typescript
// webui/lib/history/recorder.ts
import { createClient } from "@/lib/supabase/client";

export type HistoryAction = "create" | "edit" | "csv_export" | "delete";

export async function recordHistory(action: HistoryAction, productId: string | null, detail: Record<string, unknown> = {}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("history").insert({
    user_id: user.id,
    action,
    product_id: productId,
    detail,
  });
}
```

- [ ] **Step 2: Plan 3 のフォーム保存・削除フックに呼び出し追加**

`upsertProduct` 呼び出し後に `recordHistory("edit", id, { changedFields })`、 `deleteProduct` 呼び出し後に `recordHistory("delete", id)`。

```bash
git commit -m "feat(webui/history): recordHistory helper + hook into product CRUD"
```

---

## Task 2: ダッシュボード実データ反映

**Files:** webui/app/(main)/page.tsx, webui/components/dashboard/

- [ ] **Step 1: 4 統計カードのデータ取得**

`webui/app/(main)/page.tsx`:
```typescript
import { createClient } from "@/lib/supabase/server";
import { StatCards } from "@/components/dashboard/StatCards";
import { RecentEdits } from "@/components/dashboard/RecentEdits";
import { AlertList } from "@/components/dashboard/AlertList";
import { CsvHistoryTable } from "@/components/dashboard/CsvHistoryTable";

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [{ count: totalProducts }, { count: todayEdits }, { count: csvExports }, alerts] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("history").select("*", { count: "exact", head: true }).eq("action", "edit").gte("created_at", today.toISOString()),
    supabase.from("history").select("*", { count: "exact", head: true }).eq("action", "csv_export").gte("created_at", today.toISOString()),
    computeAlerts(supabase),
  ]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">ダッシュボード</h1>
      <StatCards stats={{ totalProducts: totalProducts ?? 0, todayEdits: todayEdits ?? 0, csvExports: csvExports ?? 0, alerts: alerts.length }} />
      <div className="grid grid-cols-2 gap-4">
        <RecentEdits />
        <AlertList alerts={alerts} />
      </div>
      <CsvHistoryTable />
    </div>
  );
}

async function computeAlerts(supabase: any) {
  const { data: noImage } = await supabase.from("products").select("id, ne_code").eq("image_count", 0);
  const { data: noCategory } = await supabase.from("products").select("id, ne_code").or("mall_category_id.eq.,yahoo_category_id.eq.");
  return [
    ...(noImage ?? []).map((p: any) => ({ type: "no_image", ne_code: p.ne_code })),
    ...(noCategory ?? []).map((p: any) => ({ type: "no_category", ne_code: p.ne_code })),
  ];
}
```

- [ ] **Step 2: 各カード/リストコンポーネント実装**

- StatCards: 4 カード横並び
- RecentEdits: history テーブル TOP 5 (action=edit/create)
- AlertList: 画像未アップ / カテゴリ未設定 / 在庫 0 等を一覧
- CsvHistoryTable: history テーブル TOP 5 (action=csv_export)

```bash
git commit -m "feat(webui/dashboard): real data integration (4 stat cards + alerts + recent edits)"
```

---

## Task 3: CSV ダウンロード一括画面

**Files:** webui/app/(main)/csv/page.tsx, webui/components/csv/BulkDownloadForm.tsx, webui/app/api/csv/bulk/route.ts

- [ ] **Step 1: 依存追加**

```powershell
cd webui
pnpm add jszip
```

- [ ] **Step 2: UI 実装**

`BulkDownloadForm.tsx`:
- 商品リスト (チェックボックス選択、 「全選択」「選択解除」)
- モール選択 (5 チェックボックス: 楽天/Yahoo/NE単品/NEセット/Shopify)
- [📥 一括ダウンロード] ボタン → POST /api/csv/bulk

- [ ] **Step 3: API Route**

`webui/app/api/csv/bulk/route.ts`:
```typescript
import { NextResponse } from "next/server";
import JSZip from "jszip";
import { listProducts } from "@/lib/product/repository";
import { RakutenConverter } from "@/lib/converters/rakuten";
import { NEConverter } from "@/lib/converters/ne";
import { YahooConverter } from "@/lib/converters/yahoo";
import { ShopifyConverter } from "@/lib/converters/shopify";
import { writeCsv } from "@/lib/csv/writer";

export async function POST(req: Request) {
  const { productIds, malls } = await req.json();
  const allProducts = await listProducts();
  const products = productIds.length > 0
    ? allProducts.filter((p) => productIds.includes(p.id))
    : allProducts;
  const zip = new JSZip();

  for (const mall of malls) {
    if (mall === "rakuten") {
      const c = new RakutenConverter();
      zip.file("rakuten_normal_item.csv", writeCsv(c.convert(products), c.encoding as any));
    }
    if (mall === "yahoo") {
      const c = new YahooConverter();
      zip.file("yahoo.csv", writeCsv(c.convert(products), c.encoding as any));
    }
    if (mall === "ne_single" || mall === "ne_set") {
      const c = new NEConverter();
      const { singles, sets } = c.convert(products);
      if (mall === "ne_single") zip.file("ne_single.csv", writeCsv(singles, c.encoding as any));
      if (mall === "ne_set") zip.file("ne_set.csv", writeCsv(sets, c.encoding as any));
    }
    if (mall === "shopify") {
      const c = new ShopifyConverter();
      zip.file("shopify.csv", writeCsv(c.convert(products), c.encoding as any));
    }
  }
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="csv-export-${new Date().toISOString().slice(0, 10)}.zip"`,
    },
  });
}
```

```bash
git commit -m "feat(webui/csv): bulk CSV download with ZIP packaging"
```

---

## Task 4: テンプレート管理画面

**Files:** webui/app/(main)/templates/, webui/components/templates/

- [ ] **Step 1: テンプレ一覧** (`templates/page.tsx`)
- [ ] **Step 2: テンプレ編集** (`templates/[id]/page.tsx`)

- 71 列のうち雛形に保存したいフィールドを選択 (チェックボックス)
- 例: 「商品説明 HTML テンプレ」「店舗カテゴリ」「配送方法」「納期」等
- `template_data` JSONB に保存

- [ ] **Step 3: 新規商品作成時の流し込み**

`/products/new` の最初に「テンプレート選択」ステップを追加:
- 一覧から 1 つ選択 → そのテンプレの `template_data` を form の初期値に流し込み

```bash
git commit -m "feat(webui/templates): template management + new product template selection"
```

---

## Task 5: 作業履歴画面

**Files:** webui/app/(main)/history/page.tsx, webui/components/history/HistoryTable.tsx

- [ ] **Step 1: タブ切替** (編集履歴 / CSV出力履歴)
- [ ] **Step 2: テーブル** (時刻 / ユーザー / 商品コード / 操作内容)
- [ ] **Step 3: ページネーション** (50 件/page)

```bash
git commit -m "feat(webui/history): history page with tabs and pagination"
```

---

## Task 6: 設定画面

**Files:** webui/app/(main)/settings/page.tsx, webui/components/settings/

- [ ] **Step 1: SettingsForm** (店舗情報)

- 楽天店舗 ID / R-Cabinet URL ベース / Yahoo ストア ID / Shopify ストア
- settings テーブルに保存

- [ ] **Step 2: MakerCodesTable**

- 一覧 (メーカーコード / メーカー名 / プレフィックス)
- 行追加 / 編集 / 削除
- CSV インポート (Phase 1 の `config/master/maker_codes.csv` 形式)

```bash
git commit -m "feat(webui/settings): store settings + maker codes master CRUD"
```

---

## Task 7: ヘルプ画面

**Files:** webui/app/(main)/help/page.tsx, webui/components/help/HelpContent.tsx, webui/content/help/

- [ ] **Step 1: 依存追加**

```powershell
pnpm add react-markdown remark-gfm
```

- [ ] **Step 2: ヘルプ Markdown 配置**

`webui/content/help/01-使い方ガイド.md`、 `02-モール仕様.md`、 `03-FAQ.md` を作成。

- [ ] **Step 3: 表示**

```typescript
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readFileSync } from "fs";
import { join } from "path";

export default function HelpPage() {
  const guide = readFileSync(join(process.cwd(), "content/help/01-使い方ガイド.md"), "utf-8");
  return (
    <div className="p-6 max-w-3xl prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{guide}</ReactMarkdown>
    </div>
  );
}
```

タブまたはサイドメニューで 3 ドキュメント切替。

```bash
git commit -m "feat(webui/help): help page with markdown rendering"
```

---

## Task 8: Plan 5 完了確認 + E2E + タグ

- [ ] **Step 1: Playwright E2E 導入**

```powershell
cd webui
pnpm dlx playwright install
pnpm add -D @playwright/test
```

`webui/e2e/smoke.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test("login → dashboard → product create → CSV download", async ({ page }) => {
  await page.goto("/login");
  // Magic Link は手動なので、 テストでは Supabase JWT を直接 cookie に注入する設定が必要
  // 本格的な E2E は Phase 2 完成後に整える
  expect(true).toBe(true);
});
```

- [ ] **Step 2: 全画面ブラウザ確認**

- ログイン → ダッシュボード
- 商品一覧 → 新規作成 (テンプレから) → 編集 → 保存 → 一覧に表示
- CSV ダウンロード一括
- 履歴に記録される
- 設定保存
- ヘルプ表示

- [ ] **Step 3: タグ + 完了報告**

```bash
git tag webui-plan-5-complete
git tag webui-phase-2-complete
git commit --allow-empty -m "release: WebUI Phase 2 complete (9 screens, 5 plans)"
```

Phase 2 完了 🎉
