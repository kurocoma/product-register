# WebUI Plan 3: Product CRUD (商品一覧 + 詳細編集) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans

**Goal:** 商品の一覧表示・新規作成・詳細編集 (左フォーム + 自動/手動保存) を実装する。 右ペインのプレビューはこの Plan ではダミー (Plan 4 で実装)。

**Architecture:** Supabase の `products` テーブルに対する CRUD を Next.js Server Components + Client Components の組み合わせで実装。 編集フォームは Zod 経由でバリデーション、 debounce 800ms で upsert。

**Tech Stack:** Next.js Server Actions, React Hook Form, Zod, shadcn/ui Accordion

**前提:** Plan 1, 2 完了済み

---

## ファイル構成

```
webui/
├── lib/product/repository.ts          # Supabase products CRUD
├── lib/product/repository.test.ts
├── app/(main)/products/
│   ├── page.tsx                       # 商品一覧 (実装)
│   ├── new/page.tsx                   # 新規作成
│   └── [id]/page.tsx                  # 詳細編集 (左フォーム + 右プレビュー placeholder)
├── components/product/
│   ├── ProductList.tsx                # テーブル + フィルタ + 検索
│   ├── ProductForm.tsx                # 左フォーム (アコーディオン)
│   ├── sections/
│   │   ├── BasicInfoSection.tsx
│   │   ├── ShippingSection.tsx
│   │   ├── DescriptionSection.tsx
│   │   ├── YahooGroupingSection.tsx
│   │   ├── VariationSection.tsx
│   │   ├── ImageUrlSection.tsx
│   │   └── AttributeSection.tsx
│   ├── AutoSaveIndicator.tsx          # 保存状態表示 (ヘッダー右)
│   └── ProductFormHeader.tsx          # 商品コード + 保存ボタン
└── hooks/useAutoSave.ts                # debounce 800ms upsert hook
```

---

## Task 1: Repository (Supabase products CRUD)

**Files:** webui/lib/product/repository.ts

- [ ] **Step 1: failing テスト** (Supabase mock)
- [ ] **Step 2: 実装**

```typescript
// webui/lib/product/repository.ts
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { ProductInput } from "@/lib/product/schema";

export type ProductRow = ProductInput & { id: string; user_id: string; created_at: string; updated_at: string };

export async function listProducts(): Promise<ProductRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("products").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data as ProductRow[];
}

export async function getProduct(id: string): Promise<ProductRow | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error) return null;
  return data as ProductRow;
}

export async function upsertProduct(product: Partial<ProductRow>): Promise<ProductRow> {
  const supabase = createBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("products")
    .upsert({ ...product, user_id: user!.id, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data as ProductRow;
}

export async function deleteProduct(id: string): Promise<void> {
  const supabase = createBrowserClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 3: テスト + コミット**

```bash
git add webui/lib/product/repository.*
git commit -m "feat(webui/product): Supabase products CRUD repository"
```

---

## Task 2: 商品一覧画面

**Files:** webui/app/(main)/products/page.tsx, webui/components/product/ProductList.tsx

- [ ] **Step 1: テスト**
- [ ] **Step 2: 実装**

`ProductList.tsx`:
- Table: チェックボックス | NEコード | 商品名 | 価格 | 状態 | 編集ボタン
- 検索: NEコード/商品名 部分一致
- フィルタ: メーカー (dropdown), 状態 (dropdown)
- 複数選択 → 一括 CSV 出力ボタン (Plan 5 で実装、 ここではボタンだけ)
- 行クリック → /products/[id]

- [ ] **Step 3: コミット**

```bash
git commit -m "feat(webui/product): product list with search/filter/multi-select"
```

---

## Task 3: 新規作成ページ

**Files:** webui/app/(main)/products/new/page.tsx

- [ ] **Step 1: テンプレ選択ステップ** (テンプレ管理は Plan 5 だが入口は用意)
- [ ] **Step 2: 空の ProductForm を表示**
- [ ] **Step 3: 保存ボタンで /products/[新ID] にリダイレクト**

```bash
git commit -m "feat(webui/product): new product creation page"
```

---

## Task 4: ProductForm 骨格 + アコーディオン

**Files:** webui/components/product/ProductForm.tsx, sections/

- [ ] **Step 1: failing テスト** (7 セクションが全て表示される)
- [ ] **Step 2: 実装** — shadcn/ui Accordion で 7 セクション。 デフォルト全展開 (`type="multiple" defaultValue={["basic", "shipping", ...]}`)

```typescript
// webui/components/product/ProductForm.tsx (抜粋)
"use client";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { ProductInputSchema, type ProductInput } from "@/lib/product/schema";
import { BasicInfoSection } from "./sections/BasicInfoSection";
// ... 他 6 セクション

export function ProductForm({ initial, onChange }: { initial: Partial<ProductInput>; onChange: (data: ProductInput) => void }) {
  const form = useForm<ProductInput>({
    resolver: zodResolver(ProductInputSchema),
    defaultValues: initial,
    mode: "onChange",
  });
  form.watch((data) => onChange(data as ProductInput));

  return (
    <FormProvider {...form}>
      <Accordion type="multiple" defaultValue={["basic", "shipping", "description", "yahoo", "variation", "image", "attribute"]}>
        <AccordionItem value="basic">
          <AccordionTrigger>基本情報</AccordionTrigger>
          <AccordionContent><BasicInfoSection /></AccordionContent>
        </AccordionItem>
        {/* 残り 6 セクション */}
      </Accordion>
    </FormProvider>
  );
}
```

各セクションコンポーネントは `useFormContext` で hook を取得して input を描画。

```bash
pnpm add react-hook-form @hookform/resolvers
git commit -m "feat(webui/product): ProductForm with 7-accordion sections (multi-expand)"
```

---

## Task 5: 自動保存 + 手動保存

**Files:** webui/hooks/useAutoSave.ts, webui/components/product/AutoSaveIndicator.tsx, ProductFormHeader.tsx

- [ ] **Step 1: useAutoSave hook 実装** (debounce 800ms)

```typescript
// webui/hooks/useAutoSave.ts
import { useEffect, useRef, useState } from "react";

export function useAutoSave<T>(value: T, onSave: (v: T) => Promise<void>, delayMs = 800) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await onSave(value);
        setStatus("saved");
        setSavedAt(new Date());
      } catch {
        setStatus("error");
      }
    }, delayMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value]);

  return { status, savedAt };
}
```

- [ ] **Step 2: AutoSaveIndicator + 手動保存ボタン**

```typescript
// AutoSaveIndicator.tsx
export function AutoSaveIndicator({ status, savedAt }: { status: string; savedAt: Date | null }) {
  if (status === "saving") return <span className="text-slate-500 text-sm">保存中...</span>;
  if (status === "error") return <span className="text-red-600 text-sm">⚠ 保存失敗</span>;
  if (savedAt) return <span className="text-green-700 text-sm">✓ 自動保存済み {savedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>;
  return null;
}
```

`ProductFormHeader.tsx` に AutoSaveIndicator + 手動「保存」ボタン (`Button` shadcn) 配置。

- [ ] **Step 3: コミット**

```bash
git commit -m "feat(webui/product): auto-save (debounce 800ms) + manual save button"
```

---

## Task 6: 詳細編集画面組み立て

**Files:** webui/app/(main)/products/[id]/page.tsx

- [ ] **Step 1: 実装**

```typescript
import { getProduct } from "@/lib/product/repository";
import { ProductEditView } from "@/components/product/ProductEditView";

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return <div className="p-6">商品が見つかりません</div>;
  return <ProductEditView product={product} />;
}
```

`ProductEditView.tsx` (Client Component):
- ヘッダー: 商品コード + AutoSaveIndicator + 手動保存ボタン
- 左 40%: ProductForm
- 右 60%: タブ "楽天 / Yahoo / Shopify" (中身は Plan 4 で実装、 ここでは placeholder) + CSV ダウンロードボタン (Plan 5)
- 自動保存: useAutoSave で products テーブルに upsert

- [ ] **Step 2: コミット**

```bash
git commit -m "feat(webui/product): product edit view (left form + right placeholder + auto-save)"
```

---

## Task 7: 削除機能

**Files:** ProductList.tsx 内ボタン + 確認ダイアログ

- [ ] **Step 1: shadcn/ui Dialog で確認モーダル**
- [ ] **Step 2: deleteProduct(id) → router.refresh()**

```bash
git commit -m "feat(webui/product): delete with confirm dialog"
```

---

## Task 8: Plan 3 完了確認 + タグ

- [ ] **Step 1: テスト・ビルド**
- [ ] **Step 2: ブラウザ動作確認** (一覧 → 詳細 → 編集 → 自動保存 → 削除)
- [ ] **Step 3: タグ**

```bash
git tag webui-plan-3-complete
```

Plan 3 完了 → Plan 4 (Mall Previews) へ。
