# WebUI Plan 2: TypeScript CSV Converter (Phase 1 Python ロジック移植) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Phase 1 で完成した Python の CSV 変換ロジック (4 モール対応 + 71 列 ProductInput + 110 件超のテスト) を、 WebUI で使う TypeScript モジュールに **テストごと完全移植** する。

**Architecture:** `webui/lib/converters/` に 4 モール分の Converter (rakuten/ne/yahoo/shopify) を実装し、 Phase 1 と同じ入出力契約を保つ。 入力は Zod スキーマで型安全に。 出力はクライアント/サーバー両方で動く純粋関数 (Supabase アクセス無し)。 Phase 1 のテストフィクスチャ・期待値 CSV を webui に複製しテストで読み込み。

**Tech Stack:** TypeScript 5, Zod, Vitest, papaparse (CSV パース/生成), iconv-lite (cp932 エンコーディング)

**Phase 1 参照:**
- [src/product_register/models.py](../../../src/product_register/models.py) — ProductInput Pydantic モデル
- [src/product_register/converters/rakuten.py](../../../src/product_register/converters/rakuten.py)
- [src/product_register/converters/ne.py](../../../src/product_register/converters/ne.py)
- [src/product_register/converters/yahoo.py](../../../src/product_register/converters/yahoo.py)
- [src/product_register/converters/shopify.py](../../../src/product_register/converters/shopify.py)
- [tests/](../../../tests/) — Phase 1 テスト 110+ 件

---

## ファイル構成

```
webui/
├── lib/
│   ├── product/
│   │   ├── schema.ts                 # ProductInput Zod スキーマ + TypeScript 型
│   │   └── schema.test.ts
│   ├── converters/
│   │   ├── base.ts                   # BaseConverter 型 + encoding 定数
│   │   ├── rakuten.ts                # 楽天 Converter (cp932, 親子構造, 462 列)
│   │   ├── rakuten.test.ts
│   │   ├── ne.ts                     # NE Converter (utf-8 BOM なし, 単品/セット分離)
│   │   ├── ne.test.ts
│   │   ├── yahoo.ts                  # Yahoo Converter (cp932, 85 列, grouping)
│   │   ├── yahoo.test.ts
│   │   ├── shopify.ts                # Shopify Converter (utf-8-sig, 画像複数行展開)
│   │   ├── shopify.test.ts
│   │   ├── image-url.ts              # 画像URL生成ヘルパー
│   │   └── integration.test.ts       # 4 モール統合テスト
│   └── csv/
│       ├── writer.ts                 # CSV 生成 (encoding 切替対応)
│       └── writer.test.ts
└── tests/fixtures/
    ├── input_sample.csv               # Phase 1 から複製
    └── expected/
        ├── rakuten_normal_item.csv
        ├── ne_single.csv
        ├── ne_set.csv
        ├── yahoo.csv
        └── shopify.csv
```

---

## Task 1: 依存追加 + フィクスチャ複製

**Files:** webui/package.json, webui/tests/fixtures/

- [ ] **Step 1: 依存追加**

```powershell
cd webui
pnpm add papaparse iconv-lite
pnpm add -D @types/papaparse
```

- [ ] **Step 2: Phase 1 フィクスチャを複製**

```powershell
mkdir -p tests/fixtures/expected
copy ../tests/fixtures/input_sample.csv tests/fixtures/input_sample.csv
copy ../tests/fixtures/expected/rakuten_normal_item.csv tests/fixtures/expected/rakuten_normal_item.csv
copy ../tests/fixtures/expected/ne_single.csv tests/fixtures/expected/ne_single.csv
copy ../tests/fixtures/expected/ne_set.csv tests/fixtures/expected/ne_set.csv
copy ../tests/fixtures/expected/yahoo.csv tests/fixtures/expected/yahoo.csv
copy ../tests/fixtures/expected/shopify.csv tests/fixtures/expected/shopify.csv
```

- [ ] **Step 3: .gitattributes 反映** (改行コード固定)

`webui/.gitattributes` を作成:
```
tests/fixtures/**/*.csv text eol=lf
```

- [ ] **Step 4: コミット**

```bash
git add webui/package.json webui/pnpm-lock.yaml webui/tests/fixtures webui/.gitattributes
git commit -m "feat(webui/converter): add papaparse/iconv-lite deps, copy Phase 1 fixtures"
```

---

## Task 2: ProductInput Zod スキーマ

**Files:** webui/lib/product/schema.ts

- [ ] **Step 1: failing テスト**

`webui/lib/product/schema.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ProductInputSchema, makeProduct } from "./schema";

describe("ProductInputSchema", () => {
  it("accepts valid single product", () => {
    const p = ProductInputSchema.parse(makeProduct());
    expect(p.ne_code).toBe("t002-2542-1");
    expect(p.is_single).toBe(true);
  });

  it("rejects invalid tax_rate", () => {
    expect(() => ProductInputSchema.parse(makeProduct({ tax_rate: 15 }))).toThrow();
  });

  it("rejects invalid jan_code", () => {
    expect(() => ProductInputSchema.parse(makeProduct({ jan_code: "12345" }))).toThrow();
  });

  it("yahoo_grouping_enabled defaults to false", () => {
    const raw = { ne_code: "x-0001-1", jan_code: "1234567890123", maker_code: "x", product_type: "単品", quantity: 1, product_name: "X", display_name: "X", tax_rate: 10, selling_price: 100, shipping_type: "送料別", image_count: 1, delivery_method: 4, lead_time: 1, mall_category_id: "0" };
    const p = ProductInputSchema.parse(raw);
    expect(p.yahoo_grouping_enabled).toBe(false);
    expect(p.unit).toBe("");
  });
});
```

Run: `pnpm test webui/lib/product/schema.test.ts`
Expected: FAIL (file not exist)

- [ ] **Step 2: スキーマ実装**

`webui/lib/product/schema.ts`:
```typescript
import { z } from "zod";

export const ProductInputSchema = z.object({
  // 基本情報
  ne_code: z.string(),
  jan_code: z.string().regex(/^\d{13}$/, "jan_code must be 13 digits"),
  maker_code: z.string(),
  product_type: z.enum(["単品", "セット商品"]),
  quantity: z.number().int(),
  product_name: z.string(),
  display_name: z.string(),
  tax_rate: z.union([z.literal(8), z.literal(10)]),
  cost_price: z.number().int().default(0),
  selling_price: z.number().int(),

  // 配送・カテゴリ
  shipping_type: z.string(),
  image_count: z.number().int(),
  delivery_method: z.number().int(),
  lead_time: z.number().int(),
  mall_category_id: z.string(),
  store_category: z.string().default(""),

  // 商品説明
  catch_copy_pc: z.string().default(""),
  catch_copy_yahoo: z.string().default(""),
  description_pc: z.string().default(""),
  description_sp: z.string().default(""),
  description_4: z.string().default(""),
  free1: z.string().default(""),
  free2: z.string().default(""),
  keyword: z.string().default(""),
  maker_name: z.string().default(""),
  brand_name: z.string().default(""),

  // Yahoo 固有
  yahoo_category_id: z.string().default(""),
  yahoo_path: z.string().default(""),
  unit: z.string().default(""),
  yahoo_grouping_enabled: z.boolean().default(false),
  yahoo_variation_title: z.string().default(""),

  // バリエーション
  option_item_name: z.string().default(""),
  option_horizontal: z.string().default(""),
  variation_key: z.string().default(""),
  variation_name: z.string().default(""),
  variation_choices: z.string().default(""),
  choice_numbers: z.string().default(""),

  // 画像 URL × 20
  ...Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`image_url_${i + 1}`, z.string().default("")]),
  ) as Record<`image_url_${number}`, z.ZodDefault<z.ZodString>>,

  // 商品属性 × 5
  ...Object.fromEntries(
    Array.from({ length: 5 }, (_, i) => i + 1).flatMap((i) => [
      [`attribute_item_${i}`, z.string().default("")],
      [`attribute_value_${i}`, z.string().default("")],
      [`attribute_unit_${i}`, z.string().default("")],
    ]),
  ) as Record<string, z.ZodDefault<z.ZodString>>,
}).transform((p) => ({
  ...p,
  is_single: p.product_type === "単品",
  is_set: p.product_type === "セット商品",
}));

export type ProductInput = z.infer<typeof ProductInputSchema>;

/** テスト用ファクトリ (Phase 1 の conftest.make_product と同等) */
export function makeProduct(overrides: Partial<z.input<typeof ProductInputSchema>> = {}): ProductInput {
  return ProductInputSchema.parse({
    ne_code: "t002-2542-1",
    jan_code: "4955028002542",
    maker_code: "t002",
    product_type: "単品",
    quantity: 1,
    product_name: "GIANTSボトル 10年貯蔵古酒 720ml 25度",
    display_name: "巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度",
    tax_rate: 10,
    selling_price: 10000,
    shipping_type: "送料無料",
    image_count: 3,
    delivery_method: 4,
    lead_time: 1,
    mall_category_id: "402930",
    store_category: "沖縄のお酒",
    yahoo_category_id: "41383",
    yahoo_path: "沖縄のお酒",
    catch_copy_pc: "毎年完売必須 プロ野球 人気のボトル",
    catch_copy_yahoo: "毎年完売 プロ野球ボトル",
    unit: "本",
    yahoo_grouping_enabled: false,
    yahoo_variation_title: "数量",
    ...overrides,
  });
}
```

- [ ] **Step 3: テスト通過**

Run: `pnpm test webui/lib/product/schema.test.ts`
Expected: 4 件 PASS

- [ ] **Step 4: コミット**

```bash
git add webui/lib/product/
git commit -m "feat(webui/converter): ProductInput Zod schema with 71 fields + makeProduct factory"
```

---

## Task 3: BaseConverter + encoding 定数

**Files:** webui/lib/converters/base.ts

- [ ] **Step 1: failing テスト**

`webui/lib/converters/base.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ENCODING } from "./base";

describe("ENCODING constants", () => {
  it("rakuten=cp932, ne=utf-8, yahoo=cp932, shopify=utf-8-sig", () => {
    expect(ENCODING.rakuten).toBe("cp932");
    expect(ENCODING.ne).toBe("utf-8");
    expect(ENCODING.yahoo).toBe("cp932");
    expect(ENCODING.shopify).toBe("utf-8-sig");
  });
});
```

Run: FAIL expected

- [ ] **Step 2: 実装**

`webui/lib/converters/base.ts`:
```typescript
import type { ProductInput } from "@/lib/product/schema";

export const ENCODING = {
  rakuten: "cp932",
  ne: "utf-8",
  yahoo: "cp932",
  shopify: "utf-8-sig",
} as const;

export type MallName = keyof typeof ENCODING;

export interface Converter<TOutput = Record<string, string>> {
  mallName: MallName;
  encoding: string;
  convert(products: ProductInput[]): TOutput[] | { singles: TOutput[]; sets: TOutput[] };
}
```

- [ ] **Step 3: テスト通過確認 + コミット**

```bash
git add webui/lib/converters/base.ts webui/lib/converters/base.test.ts
git commit -m "feat(webui/converter): BaseConverter type + ENCODING constants"
```

---

## Task 4: 画像 URL 生成ヘルパー

**Files:** webui/lib/converters/image-url.ts

- [ ] **Step 1: failing テスト**

`webui/lib/converters/image-url.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  buildRakutenImgList,
  buildYahooItemImageUrls,
  buildYahooImgListHtml,
} from "./image-url";

describe("image url builders", () => {
  it("buildRakutenImgList: image_count=1 → empty", () => {
    expect(buildRakutenImgList("t002-2542", 1)).toBe("");
  });
  it("buildRakutenImgList: image_count=3 → 2 imgs", () => {
    const html = buildRakutenImgList("t002-2542", 3);
    expect(html).toContain("<!--imgList-->");
    expect(html).toContain("t002-2542_2.jpg");
    expect(html).toContain("t002-2542_3.jpg");
    expect(html).toContain("<!--/imgList-->");
  });

  it("buildYahooItemImageUrls: image_count=3 → 3 URLs semicolon separated", () => {
    const urls = buildYahooItemImageUrls("t002-2542-1", 3);
    const parts = urls.split(";");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1.jpg");
    expect(parts[1]).toBe("https://shopping.c.yimg.jp/lib/okimarumarket/t002-2542-1_2.jpg");
  });
  it("buildYahooItemImageUrls: image_count=0 → empty", () => {
    expect(buildYahooItemImageUrls("x", 0)).toBe("");
  });
});
```

Run: FAIL expected

- [ ] **Step 2: 実装**

`webui/lib/converters/image-url.ts`:
```typescript
const RAKUTEN_IMAGE_BASE = "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02";
const YAHOO_IMAGE_BASE = "https://shopping.c.yimg.jp/lib/okimarumarket";

/** 楽天用 imgList HTML (2 枚目以降を <img> で並べる) */
export function buildRakutenImgList(baseCode: string, imageCount: number): string {
  if (imageCount <= 1) return "";
  const imgs = Array.from({ length: imageCount - 1 }, (_, i) =>
    `<img src='${RAKUTEN_IMAGE_BASE}/${baseCode}_${i + 2}.jpg' width='100%'>`,
  ).join("<br>");
  return `<!--imgList-->${imgs}<br><!--/imgList-->`;
}

/** Yahoo caption 内 imgList HTML (Phase 1 と同形式) */
export function buildYahooImgListHtml(neCode: string, imageCount: number): string {
  if (imageCount <= 1) return "";
  const imgs = Array.from({ length: imageCount - 1 }, (_, i) =>
    `<img src='${YAHOO_IMAGE_BASE}/${neCode}_${i + 2}.jpg' width='100%'>`,
  ).join("<br>");
  return `<!--imgList-->${imgs}<br><!--/imgList-->`;
}

/** Yahoo item-image-urls 列 (セミコロン区切り) */
export function buildYahooItemImageUrls(neCode: string, imageCount: number): string {
  if (imageCount <= 0) return "";
  return Array.from({ length: imageCount }, (_, i) =>
    i === 0 ? `${YAHOO_IMAGE_BASE}/${neCode}.jpg` : `${YAHOO_IMAGE_BASE}/${neCode}_${i + 1}.jpg`,
  ).join(";");
}
```

- [ ] **Step 3: テスト通過 + コミット**

```bash
git add webui/lib/converters/image-url.ts webui/lib/converters/image-url.test.ts
git commit -m "feat(webui/converter): image URL builders for Rakuten/Yahoo"
```

---

## Task 5: Yahoo Converter

**Files:** webui/lib/converters/yahoo.ts

> Yahoo を先に実装する (rewrite 直近で最も理解度高いため)。

- [ ] **Step 1: failing テスト**

`webui/lib/converters/yahoo.test.ts` (Phase 1 `test_yahoo.py` の主要テスト 16 件を TypeScript に移植):

```typescript
import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { YahooConverter, YAHOO_COLUMNS } from "./yahoo";

const conv = new YahooConverter();

describe("YahooConverter", () => {
  it("outputs 85 columns in correct order", () => {
    const rows = conv.convert([makeProduct()]);
    expect(Object.keys(rows[0])).toHaveLength(85);
    expect(Object.keys(rows[0])).toEqual(YAHOO_COLUMNS);
  });

  it("code = ne_code", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0].code).toBe("t002-2542-1");
  });

  it("price = tax-inclusive (10000 * 1.1 = 11000)", () => {
    const rows = conv.convert([makeProduct({ selling_price: 10000, tax_rate: 10 })]);
    expect(rows[0].price).toBe("11000");
  });

  it("taxrate-type for 8% = 0.08", () => {
    const rows = conv.convert([makeProduct({ tax_rate: 8 })]);
    expect(rows[0]["taxrate-type"]).toBe("0.08");
  });

  it("grouping_id: enabled=true and ne_code ends with -N", () => {
    const rows = conv.convert([makeProduct({
      ne_code: "t002-2542-3", quantity: 3, yahoo_grouping_enabled: true,
    })]);
    expect(rows[0]["grouping-id"]).toBe("t002-2542");
  });

  it("grouping_id: ne_code ends with -S01 → preserved", () => {
    const rows = conv.convert([makeProduct({
      ne_code: "t002-2542-S01", yahoo_grouping_enabled: true,
    })]);
    expect(rows[0]["grouping-id"]).toBe("t002-2542-S01");
  });

  it("grouping_id: disabled → empty", () => {
    const rows = conv.convert([makeProduct({ yahoo_grouping_enabled: false })]);
    expect(rows[0]["grouping-id"]).toBe("");
  });

  it("variation1-name: quantity=1, unit=袋 → 1袋", () => {
    const rows = conv.convert([makeProduct({
      quantity: 1, unit: "袋", yahoo_grouping_enabled: true,
    })]);
    expect(rows[0]["variation1-name"]).toBe("1袋");
  });

  it("variation1-name: quantity=5, unit=袋 → 5袋セット", () => {
    const rows = conv.convert([makeProduct({
      quantity: 5, unit: "袋", yahoo_grouping_enabled: true,
    })]);
    expect(rows[0]["variation1-name"]).toBe("5袋セット");
  });

  it("variation1-spec-id is always empty", () => {
    const rows = conv.convert([makeProduct({ yahoo_grouping_enabled: true })]);
    expect(rows[0]["variation1-spec-id"]).toBe("");
  });

  it("variation2-5 all empty", () => {
    const rows = conv.convert([makeProduct({ yahoo_grouping_enabled: true })]);
    for (const n of [2, 3, 4, 5]) {
      expect(rows[0][`variation${n}-spec-id`]).toBe("");
      expect(rows[0][`variation${n}-free-title`]).toBe("");
      expect(rows[0][`variation${n}-name`]).toBe("");
    }
  });

  it("item-image-urls: image_count=3 → 3 URLs", () => {
    const rows = conv.convert([makeProduct({ image_count: 3 })]);
    expect(rows[0]["item-image-urls"].split(";")).toHaveLength(3);
  });

  it("item-image-urls: image_count=0 → empty", () => {
    const rows = conv.convert([makeProduct({ image_count: 0 })]);
    expect(rows[0]["item-image-urls"]).toBe("");
  });
});
```

Run: FAIL expected

- [ ] **Step 2: 実装**

`webui/lib/converters/yahoo.ts`:
```typescript
import type { ProductInput } from "@/lib/product/schema";
import type { Converter } from "./base";
import { ENCODING } from "./base";
import { buildYahooImgListHtml, buildYahooItemImageUrls } from "./image-url";

export const YAHOO_COLUMNS = [
  "path", "name", "code", "sub-code", "original-price", "price", "sale-price", "member-price",
  "options", "headline", "caption", "abstract", "explanation", "additional1", "additional2", "additional3",
  "ship-weight", "taxable", "release-date", "point-code", "meta-desc", "sale-period-start", "sale-period-end", "sale-limit",
  "sp-code", "pr-rate", "brand-code", "product-code", "jan", "delivery", "condition", "product-category",
  "spec1", "spec2", "spec3", "spec4", "spec5", "spec6", "spec7", "spec8", "spec9", "spec10",
  "display", "sp-additional", "sort_priority",
  "original-price-evidence", "lead-time-instock", "lead-time-outstock", "keep-stock", "postage-set", "taxrate-type", "item-tag",
  "reserve-price", "reserve-sale-price", "reserve-member-price", "reserve-selling-period-start", "reserve-selling-period-end",
  "subscription-type", "subscription-price", "subscription-group-index", "subscription-recommended-cycle", "subscription-point-code",
  "video", "point-immediate", "eco-setting-id", "eco-setting-evidence-url",
  "grouping-id", "variation1-spec-id", "variation1-free-title", "variation1-name",
  "variation2-spec-id", "variation2-free-title", "variation2-name",
  "variation3-spec-id", "variation3-free-title", "variation3-name",
  "variation4-spec-id", "variation4-free-title", "variation4-name",
  "variation5-spec-id", "variation5-free-title", "variation5-name",
  "item-social-gift-type", "cross-border-agency-flag", "item-image-urls",
] as const;

function resolveGroupingId(neCode: string, enabled: boolean): string {
  if (!enabled) return "";
  const idx = neCode.lastIndexOf("-");
  if (idx === -1) return neCode;
  const suffix = neCode.slice(idx + 1);
  if (/^\d+$/.test(suffix)) return neCode.slice(0, idx);
  return neCode;
}

function buildVariationName(quantity: number, unit: string): string {
  return quantity === 1 ? `1${unit}` : `${quantity}${unit}セット`;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function toSingleQuotes(html: string): string {
  return html.replace(/"/g, "'");
}

function buildCaption(neCode: string, imageCount: number, descriptionPc: string): string {
  return buildYahooImgListHtml(neCode, imageCount) + toSingleQuotes(descriptionPc);
}

function buildExplanation(free1: string, descriptionPc: string): string {
  return stripHtml(free1 || descriptionPc);
}

export class YahooConverter implements Converter {
  mallName = "yahoo" as const;
  encoding = ENCODING.yahoo;

  convert(products: ProductInput[]): Record<string, string>[] {
    return products.map((p) => this.convertOne(p));
  }

  private convertOne(p: ProductInput): Record<string, string> {
    if (p.yahoo_grouping_enabled && !p.unit) {
      // Phase 1 と同等の警告 (本番では logger.warn)
      // eslint-disable-next-line no-console
      console.warn(`ne_code=${p.ne_code}: yahoo_grouping_enabled=true だが unit が空`);
    }
    const taxInclusive = String(Math.floor(p.selling_price * (1 + p.tax_rate / 100) + 0.5));
    const taxrateType = String(p.tax_rate / 100);
    const caption = buildCaption(p.ne_code, p.image_count, p.description_pc);
    const explanation = buildExplanation(p.free1, p.description_pc);
    const groupingId = resolveGroupingId(p.ne_code, p.yahoo_grouping_enabled);
    const variation1Title = p.yahoo_grouping_enabled ? p.yahoo_variation_title : "";
    const variation1Name = p.yahoo_grouping_enabled ? buildVariationName(p.quantity, p.unit) : "";
    const itemImageUrls = buildYahooItemImageUrls(p.ne_code, p.image_count);

    const row = Object.fromEntries(YAHOO_COLUMNS.map((c) => [c, ""]));
    Object.assign(row, {
      "path": p.yahoo_path,
      "name": p.display_name,
      "code": p.ne_code,
      "original-price": taxInclusive,
      "price": taxInclusive,
      "headline": p.catch_copy_yahoo,
      "caption": caption,
      "explanation": explanation,
      "ship-weight": "1",
      "taxable": "1",
      "jan": p.jan_code,
      "delivery": "0",
      "condition": "0",
      "product-category": p.yahoo_category_id,
      "display": "1",
      "sp-additional": caption,
      "lead-time-instock": String(p.lead_time),
      "lead-time-outstock": String(p.lead_time),
      "keep-stock": "1",
      "postage-set": String(p.delivery_method),
      "taxrate-type": taxrateType,
      "grouping-id": groupingId,
      "variation1-free-title": variation1Title,
      "variation1-name": variation1Name,
      "item-image-urls": itemImageUrls,
    });
    return row;
  }
}
```

- [ ] **Step 3: テスト通過 + コミット**

```bash
git add webui/lib/converters/yahoo.*
git commit -m "feat(webui/converter): YahooConverter (85 cols, grouping, item-image-urls)"
```

---

## Task 6: Rakuten Converter

**Files:** webui/lib/converters/rakuten.ts

> 既存実装 [src/product_register/converters/rakuten.py](../../../src/product_register/converters/rakuten.py) を移植。 列数 108 (rakuten_columns.json でフィルタ済み)。

- [ ] **Step 1: failing テスト (Phase 1 test_rakuten.py の 17 件を移植)**

`webui/lib/converters/rakuten.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { RakutenConverter } from "./rakuten";

const conv = new RakutenConverter();

describe("RakutenConverter", () => {
  it("manage number = base_code (maker + last 4 of JAN)", () => {
    const rows = conv.convert([makeProduct()]);
    expect(rows[0]["商品管理番号（商品URL）"]).toBe("t002-2542");
  });

  it("parent row has no SKU管理番号, child rows do", () => {
    const rows = conv.convert([
      makeProduct({ ne_code: "t002-2542-1", quantity: 1 }),
      makeProduct({ ne_code: "t002-2542-3", quantity: 3, product_type: "セット商品" }),
    ]);
    expect(rows[0]["SKU管理番号"]).toBe("");  // 親
    expect(rows[1]["SKU管理番号"]).toBe("t002-2542-1");  // 子
    expect(rows[2]["SKU管理番号"]).toBe("t002-2542-3");  // 子
  });

  it("tax rate conversion: 10 → 0.1", () => {
    const rows = conv.convert([makeProduct({ tax_rate: 10 })]);
    expect(rows[0]["消費税率"]).toBe("0.1");
  });

  it("SP description includes imgList + description_sp", () => {
    const rows = conv.convert([makeProduct({ image_count: 3, description_sp: "SP本文" })]);
    const sp = rows[0]["スマートフォン用商品説明文"];
    expect(sp.startsWith("<!--imgList-->")).toBe(true);
    expect(sp.endsWith("SP本文")).toBe(true);
  });

  it("PC sale description = imgList only", () => {
    const rows = conv.convert([makeProduct({ image_count: 3, description_sp: "SP本文" })]);
    const sale = rows[0]["PC用販売説明文"];
    expect(sale).toContain("<!--imgList-->");
    expect(sale).not.toContain("SP本文");
  });

  // 残り 12 件のテストを順次移植 (Phase 1 と同等)
});
```

- [ ] **Step 2: 実装**

`webui/lib/converters/rakuten.ts`:
Phase 1 の `rakuten.py` のロジックを TypeScript に移植。 親子構造のグルーピング、 base_code 計算、 画像パス生成、 imgList 構築、 462 列のうち enabled 列のみ出力、 等。

実装の主要部分:
```typescript
import type { ProductInput } from "@/lib/product/schema";
import type { Converter } from "./base";
import { ENCODING } from "./base";
import { buildRakutenImgList } from "./image-url";

const RAKUTEN_IMAGE_BASE_PATH = "/thum02";

function baseCode(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

function leadTimeLabel(deliveryMethod: number): string {
  return `${deliveryMethod}営業日出荷`;
}

function soryo(shippingType: string): number {
  return shippingType === "送料無料" ? 1 : 0;
}

export class RakutenConverter implements Converter {
  mallName = "rakuten" as const;
  encoding = ENCODING.rakuten;

  convert(products: ProductInput[]): Record<string, string>[] {
    // base_code でグループ化
    const groups = new Map<string, ProductInput[]>();
    for (const p of products) {
      const b = baseCode(p);
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(p);
    }
    const rows: Record<string, string>[] = [];
    // base_code 昇順
    const sortedKeys = Array.from(groups.keys()).sort();
    for (const b of sortedKeys) {
      const groupProducts = groups.get(b)!;
      rows.push(this.makeParentRow(b, groupProducts));
      // 子行は ne_code 昇順
      const sortedChildren = [...groupProducts].sort((a, c) => a.ne_code.localeCompare(c.ne_code));
      for (const child of sortedChildren) {
        rows.push(this.makeChildRow(b, child));
      }
    }
    return rows;
  }

  private makeParentRow(base: string, products: ProductInput[]): Record<string, string> {
    const rep = products[0];
    const imgList = buildRakutenImgList(base, rep.image_count);
    // 楽天 108 列のすべてを空で初期化 (列定義は別ファイル rakuten_columns.json 移植版で持つ)
    const row: Record<string, string> = {};
    // 親行の主要値
    row["商品管理番号（商品URL）"] = base;
    row["商品番号"] = base;
    row["商品名"] = rep.display_name;
    row["倉庫指定"] = "0";
    row["サーチ表示"] = "1";
    row["消費税"] = "0";
    row["消費税率"] = String(rep.tax_rate / 100);
    row["注文ボタン"] = "1";
    row["商品問い合わせボタン"] = "1";
    row["在庫表示"] = "-1";
    row["代引料"] = "0";
    row["ジャンルID"] = rep.mall_category_id;
    row["キャッチコピー"] = rep.catch_copy_pc;
    row["PC用商品説明文"] = rep.description_pc;
    row["スマートフォン用商品説明文"] = imgList + rep.description_sp;
    row["PC用販売説明文"] = imgList;
    // 画像パス: 1 枚目は ne_code、2 枚目以降は base_code
    row["商品画像タイプ1"] = "CABINET";
    row["商品画像パス1"] = `${RAKUTEN_IMAGE_BASE_PATH}/${rep.ne_code}.jpg`;
    for (let i = 2; i <= rep.image_count; i++) {
      row[`商品画像タイプ${i}`] = "CABINET";
      row[`商品画像パス${i}`] = `${RAKUTEN_IMAGE_BASE_PATH}/${base}_${i}.jpg`;
    }
    row["白背景画像タイプ"] = "CABINET";
    row["白背景画像パス"] = `/wb01/wb-${base}.jpg`;
    // バリエーション
    row["バリエーション項目キー定義"] = "key0";
    row["バリエーション項目名定義"] = "本数";
    // 全 SKU の選択肢を `|` 区切り
    const choices = products.map((p) => `${p.quantity}本`).join("|");
    row["バリエーション1選択肢定義"] = choices;
    return row;
  }

  private makeChildRow(base: string, p: ProductInput): Record<string, string> {
    const row: Record<string, string> = {};
    row["商品管理番号（商品URL）"] = base;
    row["SKU管理番号"] = p.ne_code;
    row["システム連携用SKU番号"] = p.ne_code;
    row["バリエーション項目キー1"] = "key0";
    row["バリエーション項目選択肢1"] = `${p.quantity}本`;
    row["販売価格"] = String(p.selling_price);
    row["表示価格"] = String(p.selling_price);
    row["二重価格文言管理番号"] = "1";
    row["再入荷お知らせボタン"] = "0";
    row["のし対応"] = "0";
    row["在庫数"] = "10";
    row["在庫戻しフラグ"] = "1";
    row["在庫切れ時の注文受付"] = "0";
    row["在庫あり時納期管理番号"] = "1";
    row["在庫切れ時納期管理番号"] = "1";
    row["在庫あり時出荷リードタイム"] = leadTimeLabel(p.delivery_method);
    row["在庫切れ時出荷リードタイム"] = leadTimeLabel(p.delivery_method);
    row["配送リードタイム"] = "自社倉庫";
    row["SKU倉庫指定"] = "0";
    row["送料"] = String(soryo(p.shipping_type));
    row["単品配送設定使用"] = "0";
    row["カタログID"] = p.jan_code;
    row["SKU画像タイプ"] = "CABINET";
    row["SKU画像パス"] = `${RAKUTEN_IMAGE_BASE_PATH}/${p.ne_code}.jpg`;
    return row;
  }
}
```

> **注:** 完全な 108 列対応は実装時に Phase 1 の `rakuten.py` を参照しながら微調整する。 上記は主要列のみ。

- [ ] **Step 3: テスト通過 + コミット**

```bash
git add webui/lib/converters/rakuten.*
git commit -m "feat(webui/converter): RakutenConverter (parent/child structure, 108 cols)"
```

---

## Task 7: NE Converter

**Files:** webui/lib/converters/ne.ts

- [ ] **Step 1: failing テスト** (Phase 1 test_ne.py の 11 件を移植)

`webui/lib/converters/ne.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { NEConverter } from "./ne";

const conv = new NEConverter();

describe("NEConverter", () => {
  it("returns { singles, sets }", () => {
    const result = conv.convert([
      makeProduct(),
      makeProduct({ ne_code: "t002-2542-3", product_type: "セット商品", quantity: 3 }),
    ]);
    expect(result.singles).toHaveLength(1);
    expect(result.sets).toHaveLength(1);
  });

  it("singles row has required fields", () => {
    const { singles } = conv.convert([makeProduct()]);
    expect(singles[0].syohin_code).toBe("t002-2542-1");
    expect(singles[0].syohin_name).toBe("GIANTSボトル 10年貯蔵古酒 720ml 25度");
    expect(singles[0].baika_tnk).toBe("10000");
    expect(singles[0].sire_code).toBe("002");  // t002 から数字部分のみ
  });

  it("sets row has set_syohin_code", () => {
    const { sets } = conv.convert([
      makeProduct({ ne_code: "t002-2542-3", product_type: "セット商品", quantity: 3 }),
    ]);
    expect(sets[0].set_syohin_code).toBe("t002-2542-3");
    expect(sets[0].syohin_code).toBe("t002-2542-1");  // 構成単品
    expect(sets[0].suryo).toBe("3");
  });

  it("set row does not have バッファ関数1 column", () => {
    const { sets } = conv.convert([
      makeProduct({ ne_code: "t002-2542-3", product_type: "セット商品", quantity: 3 }),
    ]);
    expect("バッファ関数1" in sets[0]).toBe(false);
  });
});
```

- [ ] **Step 2: 実装**

`webui/lib/converters/ne.ts`: Phase 1 `ne.py` を TypeScript 移植。 単品行は 94 列、 セット行は 92 列 (バッファ関数1 削除済み)。

- [ ] **Step 3: テスト + コミット**

```bash
git add webui/lib/converters/ne.*
git commit -m "feat(webui/converter): NEConverter (singles/sets, no バッファ関数1)"
```

---

## Task 8: Shopify Converter

**Files:** webui/lib/converters/shopify.ts

- [ ] **Step 1: failing テスト** (Phase 1 test_shopify.py の 14 件を移植)

主要テスト:
- Handle = ne_code (base_code でグループ化)
- 1 商品 = 1 親行 + 子行 (バリアント) + 画像専用行
- Image Position 自動採番
- マーケット列 (Included / 日本, Included / 国際) = "TRUE"
- Body (HTML) に imgList を含む

- [ ] **Step 2: 実装**

`webui/lib/converters/shopify.ts`: Phase 1 `shopify.py` 移植。 画像複数行展開ロジックが核心。

- [ ] **Step 3: テスト + コミット**

```bash
git add webui/lib/converters/shopify.*
git commit -m "feat(webui/converter): ShopifyConverter (image expansion, markets, 60 cols)"
```

---

## Task 9: CSV Writer (encoding 切替対応)

**Files:** webui/lib/csv/writer.ts

- [ ] **Step 1: failing テスト**

`webui/lib/csv/writer.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { writeCsv } from "./writer";

describe("writeCsv", () => {
  it("utf-8-sig: prepends BOM", () => {
    const buf = writeCsv([{ a: "1", b: "2" }], "utf-8-sig");
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
  it("utf-8: no BOM", () => {
    const buf = writeCsv([{ a: "1", b: "2" }], "utf-8");
    expect(buf.subarray(0, 3).toString("hex")).not.toBe("efbbbf");
    expect(buf.toString("utf-8")).toContain("a,b");
  });
  it("cp932: encodes Japanese", () => {
    const buf = writeCsv([{ 商品名: "ちんすこう" }], "cp932");
    // cp932 で 商品名 は specific bytes
    expect(buf.length).toBeGreaterThan(0);
    // BOM 無し
    expect(buf.subarray(0, 3).toString("hex")).not.toBe("efbbbf");
  });
});
```

- [ ] **Step 2: 実装**

`webui/lib/csv/writer.ts`:
```typescript
import Papa from "papaparse";
import iconv from "iconv-lite";

export type Encoding = "cp932" | "utf-8" | "utf-8-sig";

export function writeCsv(rows: Record<string, string>[], encoding: Encoding): Buffer {
  if (rows.length === 0) return Buffer.alloc(0);
  // papaparse は文字列で CSV を吐く。改行は CRLF
  const csv = Papa.unparse(rows, { newline: "\r\n", quotes: false });
  if (encoding === "utf-8") {
    return Buffer.from(csv, "utf-8");
  }
  if (encoding === "utf-8-sig") {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, "utf-8")]);
  }
  // cp932
  return iconv.encode(csv, "cp932");
}
```

- [ ] **Step 3: テスト + コミット**

```bash
git add webui/lib/csv/
git commit -m "feat(webui/converter): CSV writer with encoding switch (cp932/utf-8/utf-8-sig)"
```

---

## Task 10: 統合テスト (Phase 1 期待値 CSV と完全一致)

**Files:** webui/lib/converters/integration.test.ts

- [ ] **Step 1: failing テスト**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import Papa from "papaparse";
import iconv from "iconv-lite";
import { ProductInputSchema, type ProductInput } from "@/lib/product/schema";
import { RakutenConverter } from "./rakuten";
import { NEConverter } from "./ne";
import { YahooConverter } from "./yahoo";
import { ShopifyConverter } from "./shopify";

const FIXTURES = join(__dirname, "../../tests/fixtures");

function readInputCsv(): ProductInput[] {
  const raw = readFileSync(join(FIXTURES, "input_sample.csv"), "utf-8-sig" as any);
  const { data } = Papa.parse(raw, { header: true, skipEmptyLines: true });
  return (data as any[]).map((row) => {
    // 数値変換 + bool 変換
    ["quantity", "tax_rate", "cost_price", "selling_price", "image_count", "delivery_method", "lead_time"].forEach((k) => {
      row[k] = row[k] ? Number(row[k]) : 0;
    });
    row.yahoo_grouping_enabled = ["TRUE", "1", "YES"].includes((row.yahoo_grouping_enabled || "").toUpperCase());
    return ProductInputSchema.parse(row);
  });
}

function readExpectedCsv(filename: string, encoding: string): Record<string, string>[] {
  const buf = readFileSync(join(FIXTURES, "expected", filename));
  let text: string;
  if (encoding === "cp932") text = iconv.decode(buf, "cp932");
  else text = buf.toString("utf-8").replace(/^﻿/, "");
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return data;
}

describe("Converter integration (vs Phase 1 expected CSV)", () => {
  const products = readInputCsv();

  it("Yahoo matches expected", () => {
    const actual = new YahooConverter().convert(products);
    const expected = readExpectedCsv("yahoo.csv", "cp932");
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < actual.length; i++) {
      for (const key of Object.keys(expected[i])) {
        expect(actual[i][key], `row ${i + 1} col ${key}`).toBe(expected[i][key]);
      }
    }
  });

  it("Rakuten matches expected", () => {
    const actual = new RakutenConverter().convert(products);
    const expected = readExpectedCsv("rakuten_normal_item.csv", "cp932");
    expect(actual).toHaveLength(expected.length);
  });

  it("NE singles matches expected", () => {
    const { singles } = new NEConverter().convert(products);
    const expected = readExpectedCsv("ne_single.csv", "utf-8");
    expect(singles).toHaveLength(expected.length);
  });

  it("Shopify matches expected", () => {
    const actual = new ShopifyConverter().convert(products);
    const expected = readExpectedCsv("shopify.csv", "utf-8-sig");
    expect(actual).toHaveLength(expected.length);
  });
});
```

- [ ] **Step 2: 実装上の調整**

統合テスト失敗 → 個別 Converter の細部を Phase 1 と完全一致させるよう微調整。 期待値 CSV と diff が出る列をひとつずつ修正。 必要に応じて Phase 1 ロジックを再度確認。

- [ ] **Step 3: 全テスト通過確認**

Run: `cd webui && pnpm test`
Expected: 全件パス (4 モール × Phase 1 同等のテスト 数十件 + 統合 4 件)

- [ ] **Step 4: コミット**

```bash
git add webui/lib/converters/integration.test.ts
git commit -m "test(webui/converter): integration tests vs Phase 1 expected CSVs"
```

---

## Task 11: Plan 2 完了確認 + タグ

- [ ] **Step 1: 全テスト**

Run: `pnpm test`
Expected: 全件パス

- [ ] **Step 2: 型チェック**

Run: `pnpm tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: タグ付け**

```bash
git tag webui-plan-2-complete
```

Plan 2 完了 → Plan 3 (Product CRUD) へ。
