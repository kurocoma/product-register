# WebUI Plan 4: Mall Previews (3 モールストア風 UI クローン) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans

**Goal:** 商品編集画面の右ペインに、 楽天/Yahoo/Shopify 各モールの本番ストア風 UI を再現したプレビューコンポーネントを実装する。 左フォームの入力編集が即時反映される。

**Architecture:** タブ切替 (shadcn/ui Tabs)。 各 Preview コンポーネントは `ProductInput` を受け取り、 純粋関数的にレンダリング。 Phase 1 で実装した変換ロジックを **クライアント側で呼び出して** CSV 行と同等の値を計算 → モール風 UI に流し込む。

**Tech Stack:** React, Tailwind, shadcn/ui Tabs, dangerouslySetInnerHTML (商品説明 HTML 表示)

**前提:** Plan 1〜3 完了済み

---

## ファイル構成

```
webui/components/preview/
├── PreviewTabs.tsx                # タブ切替コンテナ
├── RakutenPreview.tsx             # 楽天ストア風 UI
├── YahooPreview.tsx               # Yahoo ストア風 UI (grouping セレクタ重要)
├── ShopifyPreview.tsx             # Shopify ストアフロント風 UI
└── shared/
    ├── ImageGallery.tsx           # 画像ギャラリー (共通)
    └── PriceDisplay.tsx           # 価格表示 (モール別カラー)
```

---

## Task 1: PreviewTabs コンテナ

**Files:** webui/components/preview/PreviewTabs.tsx

- [ ] **Step 1: 実装**

```typescript
"use client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RakutenPreview } from "./RakutenPreview";
import { YahooPreview } from "./YahooPreview";
import { ShopifyPreview } from "./ShopifyPreview";
import type { ProductInput } from "@/lib/product/schema";

export function PreviewTabs({ product, peers }: { product: ProductInput; peers: ProductInput[] }) {
  return (
    <Tabs defaultValue="rakuten" className="w-full">
      <TabsList>
        <TabsTrigger value="rakuten">楽天</TabsTrigger>
        <TabsTrigger value="yahoo">Yahoo</TabsTrigger>
        <TabsTrigger value="shopify">Shopify</TabsTrigger>
      </TabsList>
      <TabsContent value="rakuten">
        <RakutenPreview product={product} peers={peers} />
      </TabsContent>
      <TabsContent value="yahoo">
        <YahooPreview product={product} peers={peers} />
      </TabsContent>
      <TabsContent value="shopify">
        <ShopifyPreview product={product} peers={peers} />
      </TabsContent>
    </Tabs>
  );
}
```

> `peers` = 同じ base_code/grouping-id を持つ他の商品リスト (バリエーション選択肢を構築するため)

- [ ] **Step 2: ProductEditView から呼び出す**

`ProductEditView.tsx` の右ペインで `<PreviewTabs product={currentFormData} peers={peers} />`。 peers は親 Server Component で同じ base_code/grouping を取得して props で渡す。

```bash
git commit -m "feat(webui/preview): PreviewTabs container with 3 mall tabs"
```

---

## Task 2: 楽天プレビュー

**Files:** webui/components/preview/RakutenPreview.tsx

### 楽天 UI 模倣ポイント

- 商品名 (大文字)
- 赤い大きな価格 `¥10,000`
- 本数セレクタ (ラジオボタン): 1本 / 3本
- オレンジ「カゴに入れる」ボタン
- 商品説明 (HTML レンダリング、 imgList 展開)
- 画像メインビュー (1 枚目) + サムネイル一覧

- [ ] **Step 1: 実装**

```typescript
"use client";
import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";

export function RakutenPreview({ product, peers }: { product: ProductInput; peers: ProductInput[] }) {
  const variants = [product, ...peers.filter((p) => p.ne_code !== product.ne_code)];
  variants.sort((a, b) => a.quantity - b.quantity);
  const [selected, setSelected] = useState(product.ne_code);
  const current = variants.find((v) => v.ne_code === selected) ?? product;

  const imgBase = "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02";
  const images = Array.from({ length: current.image_count }, (_, i) =>
    i === 0 ? `${imgBase}/${current.ne_code}.jpg` : `${imgBase}/${current.ne_code.replace(/-\d+$/, "")}_${i + 1}.jpg`,
  );

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      {/* 商品画像メイン */}
      <div className="bg-slate-100 aspect-square flex items-center justify-center text-slate-400">
        {images[0] && <img src={images[0]} alt="" className="max-h-full" onError={(e) => (e.currentTarget.style.display = "none")} />}
        {!images[0] && "(画像なし)"}
      </div>
      {/* 商品名 */}
      <h2 className="text-lg font-bold">{current.display_name || "(商品名未入力)"}</h2>
      {/* 価格 (楽天赤) */}
      <div className="text-3xl font-bold text-red-600">¥{current.selling_price.toLocaleString()}</div>
      {/* 本数セレクタ */}
      {variants.length > 1 && (
        <div className="border rounded p-3 space-y-2">
          <div className="text-sm font-semibold">本数:</div>
          {variants.map((v) => (
            <label key={v.ne_code} className="flex items-center gap-2 text-sm">
              <input type="radio" name="variant" checked={selected === v.ne_code} onChange={() => setSelected(v.ne_code)} />
              {v.quantity}本 ¥{v.selling_price.toLocaleString()}
            </label>
          ))}
        </div>
      )}
      {/* カゴに入れる */}
      <button className="w-full bg-orange-500 text-white py-3 rounded font-bold">カゴに入れる</button>
      {/* 商品説明 */}
      <div className="border-t pt-4">
        <div className="text-sm font-semibold mb-2">─── 商品説明 ───</div>
        <div className="text-sm prose max-w-none" dangerouslySetInnerHTML={{ __html: current.description_pc || "(説明文未入力)" }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
git commit -m "feat(webui/preview): RakutenPreview with red price, variant selector, HTML body"
```

---

## Task 3: Yahoo プレビュー (grouping セレクタが核心)

**Files:** webui/components/preview/YahooPreview.tsx

### Yahoo UI 模倣ポイント

- 商品名
- 赤い価格表示 (`¥864 ~ ¥4,320 (税込)`)
- **数量セレクタ (3 ボタン横並び、 grouping 機能をビジュアル化)**
- 「grouping-id で集約」アノテーション
- 赤「カートに入れる」ボタン
- caption HTML レンダリング

- [ ] **Step 1: 実装**

```typescript
"use client";
import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";

export function YahooPreview({ product, peers }: { product: ProductInput; peers: ProductInput[] }) {
  const grouped = product.yahoo_grouping_enabled;
  const variants = grouped
    ? [product, ...peers.filter((p) => p.yahoo_grouping_enabled && p.ne_code !== product.ne_code)].sort((a, b) => a.quantity - b.quantity)
    : [product];
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const current = variants.find((v) => v.ne_code === selectedNe) ?? product;

  const priceInclusive = (p: ProductInput) => Math.floor(p.selling_price * (1 + p.tax_rate / 100) + 0.5);
  const prices = variants.map(priceInclusive);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      <h2 className="text-lg font-bold">{current.display_name || "(商品名未入力)"}</h2>
      <div className="text-3xl font-bold text-red-600">
        ¥{minPrice.toLocaleString()}{minPrice !== maxPrice && ` 〜 ¥${maxPrice.toLocaleString()}`}
        <span className="text-sm ml-2">(税込)</span>
      </div>
      {grouped && variants.length > 1 && (
        <div className="border rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{current.yahoo_variation_title || "数量"}:</div>
            <div className="text-xs text-slate-500 bg-yellow-100 px-2 py-1 rounded">grouping-id で集約</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const name = v.quantity === 1 ? `1${v.unit}` : `${v.quantity}${v.unit}セット`;
              const active = v.ne_code === selectedNe;
              return (
                <button
                  key={v.ne_code}
                  onClick={() => setSelectedNe(v.ne_code)}
                  className={`px-4 py-2 border rounded text-sm ${active ? "bg-red-50 border-red-500 text-red-700" : "border-slate-300"}`}
                >
                  <div className="font-semibold">{name}</div>
                  <div className="text-xs">¥{priceInclusive(v).toLocaleString()}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button className="flex-1 bg-red-600 text-white py-3 rounded font-bold">カートに入れる</button>
      </div>
      <div className="border-t pt-4">
        <div className="text-sm prose max-w-none" dangerouslySetInnerHTML={{ __html: current.description_pc || "(説明文未入力)" }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
git commit -m "feat(webui/preview): YahooPreview with grouping selector (highlighted)"
```

---

## Task 4: Shopify プレビュー

**Files:** webui/components/preview/ShopifyPreview.tsx

### Shopify UI 模倣ポイント

- 商品画像ギャラリー (サムネイル+メイン)
- 商品名
- Vendor
- バリアントドロップダウン (Option1 Name + Values)
- 価格 + 「日本/国際 両方公開」バッジ
- 緑「カートに追加」ボタン
- Body (HTML) プレビュー

- [ ] **Step 1: 実装**

```typescript
"use client";
import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";

export function ShopifyPreview({ product, peers }: { product: ProductInput; peers: ProductInput[] }) {
  // base_code でグループ化
  const baseCode = `${product.maker_code}-${product.jan_code.slice(-4)}`;
  const variants = [product, ...peers.filter((p) =>
    `${p.maker_code}-${p.jan_code.slice(-4)}` === baseCode && p.ne_code !== product.ne_code
  )].sort((a, b) => a.quantity - b.quantity);
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const current = variants.find((v) => v.ne_code === selectedNe) ?? product;

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      <h2 className="text-xl font-bold">{current.display_name}</h2>
      <div className="text-sm text-slate-600">Vendor: {current.maker_name || "メーカー未設定"}</div>
      {variants.length > 1 && (
        <div>
          <label className="text-sm font-semibold block mb-1">{current.option_item_name || "セット数を選んでください"}:</label>
          <select value={selectedNe} onChange={(e) => setSelectedNe(e.target.value)} className="border rounded px-3 py-2 w-full">
            {variants.map((v) => (
              <option key={v.ne_code} value={v.ne_code}>
                {v.quantity === 1 ? `1${v.unit}` : `${v.quantity}${v.unit}セット`} (¥{v.selling_price.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="text-2xl font-bold">¥{current.selling_price.toLocaleString()} <span className="text-sm font-normal text-slate-500">(税込)</span></div>
      <div className="flex gap-2 text-xs">
        <span className="bg-green-100 text-green-800 px-2 py-1 rounded">🇯🇵 日本</span>
        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">🌐 国際</span>
      </div>
      <button className="w-full bg-green-700 text-white py-3 rounded font-bold">カートに追加</button>
      <div className="border-t pt-4 text-sm prose max-w-none" dangerouslySetInnerHTML={{ __html: current.description_pc || "(説明文未入力)" }} />
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
git commit -m "feat(webui/preview): ShopifyPreview with dropdown variant + market badges"
```

---

## Task 5: 単一商品 CSV ダウンロードパネル

**Files:** webui/components/csv/CsvDownloadPanel.tsx, webui/app/api/csv/[mall]/[id]/route.ts

- [ ] **Step 1: API Route**

`webui/app/api/csv/[mall]/[id]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { getProduct } from "@/lib/product/repository";
import { listProducts } from "@/lib/product/repository";
import { RakutenConverter } from "@/lib/converters/rakuten";
import { NEConverter } from "@/lib/converters/ne";
import { YahooConverter } from "@/lib/converters/yahoo";
import { ShopifyConverter } from "@/lib/converters/shopify";
import { writeCsv } from "@/lib/csv/writer";

const FILENAMES = {
  rakuten: "rakuten_normal_item.csv",
  ne: "ne_single.csv",
  yahoo: "yahoo.csv",
  shopify: "shopify.csv",
};
const CONVERTERS = { rakuten: RakutenConverter, ne: NEConverter, yahoo: YahooConverter, shopify: ShopifyConverter };

export async function GET(req: Request, { params }: { params: Promise<{ mall: string; id: string }> }) {
  const { mall, id } = await params;
  if (!(mall in CONVERTERS)) return new NextResponse("Unknown mall", { status: 400 });
  // 同じ base_code/grouping_id の peers も取得
  const all = await listProducts();
  const target = all.find((p) => p.id === id);
  if (!target) return new NextResponse("Not found", { status: 404 });
  const peers = all.filter((p) => p.maker_code === target.maker_code && p.jan_code === target.jan_code);
  const ConverterClass = CONVERTERS[mall as keyof typeof CONVERTERS];
  const conv = new ConverterClass();
  const result = conv.convert(peers);
  const rows = Array.isArray(result) ? result : result.singles;  // NE は singles を返す
  const buf = writeCsv(rows, conv.encoding as any);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${FILENAMES[mall as keyof typeof FILENAMES]}"`,
    },
  });
}
```

- [ ] **Step 2: CsvDownloadPanel コンポーネント**

```typescript
export function CsvDownloadPanel({ productId }: { productId: string }) {
  const malls = [
    { key: "rakuten", label: "楽天" },
    { key: "yahoo", label: "Yahoo" },
    { key: "ne", label: "NE" },
    { key: "shopify", label: "Shopify" },
  ];
  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="font-semibold mb-2">📥 CSV ダウンロード</div>
      <div className="flex gap-2">
        {malls.map((m) => (
          <a key={m.key} href={`/api/csv/${m.key}/${productId}`} download className="flex-1 text-center border rounded py-2 text-sm hover:bg-slate-50">
            {m.label}
          </a>
        ))}
      </div>
    </div>
  );
}
```

`ProductEditView` の右ペイン下に組み込み。

- [ ] **Step 3: コミット**

```bash
git commit -m "feat(webui/csv): single-product CSV download via /api/csv/[mall]/[id]"
```

---

## Task 6: Plan 4 完了確認 + タグ

- [ ] **Step 1: ブラウザ確認**: 編集画面で各タブのプレビューが入力に追従、 各 CSV ダウンロードが動作
- [ ] **Step 2: タグ**

```bash
git tag webui-plan-4-complete
```

Plan 4 完了 → Plan 5 (Auxiliary Screens) へ。
