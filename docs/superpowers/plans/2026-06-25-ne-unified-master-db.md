# 統合商品マスタDB（Phase 1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NEの3マスタ＋Excel商品管理シートを `ne_code` をスパインに統合した参照用DB（3テーブル）と、ソース別CSV取込（パース・リンク解決・冪等マージ・件数レポート）＋取込管理ページを作る。

**Architecture:** Supabase に3テーブル（`ne_item_master` / `ne_set_composition` / `ne_mall_code`、user_id+RLS）。取込は「バイト列をUTF-8/Shift-JIS自動判定でデコード → papaparse(クォート系)or列位置パース(NEセット) → 純粋関数でレコード化 → repositoryでupsert/マージ」。純粋関数(decode/parse/build)はvitestでTDD、DB/APIはe2e(magic-link)で検証。

**Tech Stack:** Next.js 16 (App Router, route handlers, runtime=nodejs), Supabase(@supabase/ssr), papaparse 5.5.3, TextDecoder('shift_jis'/'utf-8'), vitest, tsx(e2e), openpyxl(Excel→CSV変換, Python)。

参照spec: `docs/superpowers/specs/2026-06-25-ne-unified-master-db-design.md`

---

## ファイル構成（責務）

| ファイル | 責務 |
|---|---|
| `webui/supabase/migrations/20260625000001_create_ne_masters.sql` | 3テーブル + index + RLS |
| `webui/lib/ne-master/types.ts` | レコード型 |
| `webui/lib/ne-master/decode.ts` | バイト列→文字列（UTF-8/Shift-JIS自動判定） |
| `webui/lib/ne-master/parse.ts` | ソース別CSV→生レコード（papaparse / NEセットは列位置） |
| `webui/lib/ne-master/build.ts` | 生レコード→テーブルレコード（リンク解決・マージ素材。純粋関数） |
| `webui/lib/ne-master/repository.ts` | Supabase upsert/マージ |
| `webui/app/api/masters/import/[source]/route.ts` | ソース別取込API（source=path, mall=query） |
| `webui/app/(main)/masters/page.tsx` | 取込管理ページ(server) |
| `webui/components/masters/MasterImportPanel.tsx` | アップロードUI(client) |
| `tools/excel_to_csv.py` | Excel該当シート→CSV（UTF-8）変換 |
| `webui/lib/ne-master/*.test.ts` | 純粋関数のユニット(vitest) |
| `webui/tests/e2e_ne_master_import.mjs` | 取込E2E(magic-link) |

**ソース識別子**（`[source]`）: `ne-syohin` / `ne-set` / `ne-himoduke` / `excel-master` / `excel-discon` / `excel-mall`(?mall=rakuten|yahoo|amazon|shimanoya)

---

## Task 1: マイグレーション（3テーブル + index + RLS）

**Files:**
- Create: `webui/supabase/migrations/20260625000001_create_ne_masters.sql`

- [ ] **Step 1: マイグレーションSQLを書く**

```sql
-- 統合商品マスタ(Phase 1): ne_code をスパインに NE+Excel を統合する3テーブル

create table ne_item_master (
  user_id uuid references auth.users not null,
  ne_code text not null,
  jan_code text not null default '',
  name text not null default '',
  selling_price integer,
  tax_rate integer,
  cost_price integer,
  category text not null default '',
  supplier text not null default '',
  is_set boolean not null default false,
  is_discontinued boolean not null default false,
  zaiko_renkei text not null default '',
  daihyo_code text not null default '',
  sources text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, ne_code)
);
create index ne_item_master_jan_idx on ne_item_master (user_id, jan_code);

create table ne_set_composition (
  user_id uuid references auth.users not null,
  set_ne_code text not null,
  component_ne_code text not null,
  suryo integer not null default 1,
  set_name text not null default '',
  set_price integer,
  tax_rate integer,
  primary key (user_id, set_ne_code, component_ne_code)
);
create index ne_set_comp_component_idx on ne_set_composition (user_id, component_ne_code);

create table ne_mall_code (
  user_id uuid references auth.users not null,
  ne_code text not null,
  mall text not null,
  manage_no text not null default '',
  jan_code text not null default '',
  primary key (user_id, ne_code, mall)
);
create index ne_mall_code_ne_idx on ne_mall_code (user_id, ne_code);

-- RLS（既存 products と同パターン: 本人のみ全操作）
alter table ne_item_master enable row level security;
alter table ne_set_composition enable row level security;
alter table ne_mall_code enable row level security;

create policy "own ne_item_master" on ne_item_master for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own ne_set_composition" on ne_set_composition for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own ne_mall_code" on ne_mall_code for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: 適用**

Run: `cd webui && npx supabase db push`（または既存の適用手順 `docs/supabase-cli-setup.md` に従う）
Expected: 3テーブル作成成功。`npx supabase migration list` で新マイグレーションが applied。

- [ ] **Step 3: Commit**

```bash
git add webui/supabase/migrations/20260625000001_create_ne_masters.sql
git commit -m "feat(ne-master): 統合商品マスタ3テーブル(item/set_composition/mall_code)+RLS マイグレーション"
```

---

## Task 2: デコード（UTF-8/Shift-JIS自動判定）

**Files:**
- Create: `webui/lib/ne-master/decode.ts`
- Test: `webui/lib/ne-master/decode.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// decode.test.ts
import { describe, it, expect } from "vitest";
import { decodeCsvBytes } from "./decode";

describe("decodeCsvBytes", () => {
  it("UTF-8(BOMなし)をデコード", () => {
    expect(decodeCsvBytes(Buffer.from("商品,コード\n", "utf-8"))).toContain("商品");
  });
  it("UTF-8 BOMを除去", () => {
    const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("あ", "utf-8")]);
    expect(decodeCsvBytes(b)).toBe("あ");
  });
  it("Shift-JIS(CP932)をデコード", () => {
    // 「日本」= 93 fa 96 7b
    expect(decodeCsvBytes(Buffer.from([0x93, 0xfa, 0x96, 0x7b]))).toBe("日本");
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd webui && npx vitest run lib/ne-master/decode.test.ts`
Expected: FAIL（decode未実装）

- [ ] **Step 3: 実装**

```ts
// decode.ts
/** CSVバイト列を文字列へ。BOM除去。まずUTF-8(厳格)、不正ならShift-JIS(CP932)。 */
export function decodeCsvBytes(buf: ArrayBufferLike | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // UTF-8 BOM
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(u8.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder("shift_jis").decode(u8);
  }
}
```

- [ ] **Step 4: 通過を確認**

Run: `cd webui && npx vitest run lib/ne-master/decode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add webui/lib/ne-master/decode.ts webui/lib/ne-master/decode.test.ts
git commit -m "feat(ne-master): CSVバイト列のUTF-8/Shift-JIS自動デコード"
```

---

## Task 3: ソース別パーサ（types + parse）

**Files:**
- Create: `webui/lib/ne-master/types.ts`, `webui/lib/ne-master/parse.ts`
- Test: `webui/lib/ne-master/parse.test.ts`

各ソースの列（0-indexed、spec §2/§5 準拠）。**全ソース papaparse でパースする**（クォート/改行/エスケープ対応）:
- NE商品マスタ(クォート): `syohin_code,syohin_name,baika_tnk,tax_rate,zaiko_su`
- **NEセット(RFCクォート済み142列・説明文に改行/カンマ→1論理レコードが複数物理行に跨る・物理99,857行→論理約1,663)**: papaparseで論理レコード化し**先頭8列をindex取得** `[0]=set_syohin_code,[1]=daihyo,[2]=set_name,[3]=set_baika_tnk,[4]=tax_rate,[5]=syohin_code,[6]=suryo,[7]=jan_code`。`[0]`/`[5]`がコード書式・`[6]`が整数の行のみ採用（残骸行はskip）。**※line.split(',')やレコードを物理行と仮定する実装は禁止（壊れる）**
- NE himoduke(クォート): `商品コード(0),代表商品コード(1),取込元(2),商品名(3),在庫連携(4),...モール列`
- Excel商品マスタ(CSV化): `仕入先,JANコード,NEコード,仕入先CD,商品名,仕入れ価格,税率,カテゴリ,備品フラグ`
- Excel終売(CSV化): 同上(`NEコード` 列を使う)
- Excel楽天(CSV化): `商品管理番号(0),商品番号(1=ne),項目名(2),選択肢(3),JAN(4),商品名(5),数量(6)`
- Excel Yahoo/amazon(CSV化): `商品管理番号(0),(項目名/選択肢...),JAN,商品名,数量`（ne列なし）
- Excel しまのや(CSV化): `商品コード(0=ne),分析用CD(1),名称(2),入数(3),...`

- [ ] **Step 1: 型を定義（types.ts）**

```ts
// types.ts
export type Mall = "rakuten" | "yahoo" | "amazon" | "shimanoya";

export type NeSyohinRow = { ne_code: string; name: string; selling_price: number | null; tax_rate: number | null };
export type NeSetRow = { set_ne_code: string; daihyo_code: string; set_name: string; set_price: number | null; tax_rate: number | null; component_ne_code: string; suryo: number; jan_code: string };
export type HimodukeRow = { ne_code: string; daihyo_code: string; zaiko_renkei: string };
export type ExcelMasterRow = { ne_code: string; jan_code: string; name: string; cost_price: number | null; tax_rate: number | null; category: string; supplier: string };
export type ExcelMallRow = { manage_no: string; ne_code: string; jan_code: string; suryo: number | null };
```

- [ ] **Step 2: 失敗するテストを書く（parse.test.ts）**

```ts
import { describe, it, expect } from "vitest";
import { parseNeSyohin, parseNeSet, parseHimoduke, parseExcelMaster, parseExcelMall } from "./parse";

describe("parse", () => {
  it("NE商品マスタ(クォート)", () => {
    const rows = parseNeSyohin('"syohin_code","syohin_name","baika_tnk","tax_rate","zaiko_su"\n"a008-4032-1","青切り","2191","8","99831"\n');
    expect(rows).toEqual([{ ne_code: "a008-4032-1", name: "青切り", selling_price: 2191, tax_rate: 8 }]);
  });

  it("NEセット(RFCクォート・説明文が複数行に跨る・先頭8列をindex取得・残骸行skip)", () => {
    // 実データ同様: 先頭列はクリーン、後方の説明文列が引用符内に改行・カンマを含み複数物理行に跨る。
    // papaparse が論理レコード化する前提。
    const header = "set_syohin_code,daihyo_syohin_code,set_syohin_name,set_baika_tnk,tax_rate,syohin_code,suryo,jan_code,setumei1\n";
    const rec = 'a008-4032-3,,青切りシークヮーサー500ml,6286,8,a008-4032-1,3,4582218324032,"説明文1行目,カンマ入り\n2行目\n3行目"\n';
    const rows = parseNeSet(header + rec);
    expect(rows).toHaveLength(1); // 複数物理行でも1論理レコード
    expect(rows[0]).toMatchObject({ set_ne_code: "a008-4032-3", component_ne_code: "a008-4032-1", suryo: 3, set_price: 6286 });
  });

  it("himoduke(在庫連携・代表)", () => {
    const rows = parseHimoduke("商品コード,代表商品コード,取込元,商品名,在庫連携,楽天\nr7201-3-hr3,r7201-3,,名,する,\n");
    expect(rows[0]).toEqual({ ne_code: "r7201-3-hr3", daihyo_code: "r7201-3", zaiko_renkei: "する" });
  });

  it("Excel商品マスタ(備品=NEコード空 は除外)", () => {
    const csv = "仕入先,JANコード,NEコード,仕入先CD,商品名,仕入れ価格,税率,カテゴリ,備品フラグ\nA,4955028002542,t002-2542-1,,名,1000,10,酒,\nB,RET PR,,,,備品,10,備品,〇\n";
    const rows = parseExcelMaster(csv);
    expect(rows).toEqual([{ ne_code: "t002-2542-1", jan_code: "4955028002542", name: "名", cost_price: 1000, tax_rate: 10, category: "酒", supplier: "A" }]);
  });

  it("Excel楽天(商品番号=ne_code)", () => {
    const csv = "商品管理番号,商品番号,項目名,選択肢,JANコード,商品名,数量\naogiri-sh2,a008-4032-3,,,4582218324032,青切り,3\n";
    const rows = parseExcelMall(csv, "rakuten");
    expect(rows[0]).toMatchObject({ manage_no: "aogiri-sh2", ne_code: "a008-4032-3", jan_code: "4582218324032" });
  });
});
```

- [ ] **Step 3: 失敗を確認** — Run: `npx vitest run lib/ne-master/parse.test.ts` → FAIL

- [ ] **Step 4: 実装（parse.ts）**

要点（**全ソース papaparse で `data: string[][]` を得て、ヘッダ行を捨て列indexで取り出す**。`num(s)`で整数化＝空/NaN→null）:
- `Papa.parse(text, { skipEmptyLines: true })`。これでクォート/エスケープ`""`/引用符内改行（NEセットの説明文）が**論理レコード化**される。
- **NEセット**: 各論理レコードの**先頭8列**を index で取得（`r[0]..r[7]`）。`r[0]`/`r[5]` が `/^[A-Za-z0-9_-]+$/`・`r[6]` が `/^[0-9]+$/` の行のみ採用、外れる残骸行は `skipped++`。**line.split(',')や物理行=レコードと仮定する実装は禁止**（説明文の改行で破綻する）。
- 数量・価格・税率は整数化。
- `parseExcelMall(csv, mall)`：楽天は商品番号列(index1)=ne_code、Yahoo/amazonはne_code列なしのため `ne_code=""`(後段build/repositoryでJAN+数量解決)。

（完全な実装はテストを緑にする最小で書く。）

- [ ] **Step 5: 通過を確認** — Run: `npx vitest run lib/ne-master/parse.test.ts` → PASS

- [ ] **Step 6: Commit**

```bash
git add webui/lib/ne-master/types.ts webui/lib/ne-master/parse.ts webui/lib/ne-master/parse.test.ts
git commit -m "feat(ne-master): ソース別CSVパーサ(NE3種+Excel各種, セットは列位置パース)"
```

---

## Task 4: レコードビルダー（リンク解決・純粋関数）

**Files:**
- Create: `webui/lib/ne-master/build.ts`
- Test: `webui/lib/ne-master/build.test.ts`

各ソースの生レコード → テーブル投入レコードへ変換する純粋関数群。DBに触れない（マージはrepository）。
**`sources` 配列の正規トークン（統一）**: `ne_single` / `ne_set` / `excel_master` / `excel_discon` / `himoduke`。（path の source id `ne-syohin` 等とは別物。ドリフト防止のためこの5語に固定）

- [ ] **Step 1: 失敗するテスト** — 主な関数:
  - `buildItemFromNeSyohin(rows)` → `ItemMasterPatch[]`（ne_code, selling_price, tax_rate, is_set:false, source:'ne_single'）
  - `buildItemFromNeSet(setRows)` → set distinct ごとに `ItemMasterPatch`（is_set:true, selling_price=set_price）＋ `SetCompositionRecord[]`（同(set,component)はsuryo合算）
  - `buildItemFromExcelMaster(rows)` → `ItemMasterPatch[]`（jan/cost/category/supplier/name。selling_priceは触れない）
  - `buildMallCodes(excelMallRows, mall, resolveNeByJanQty)` → `MallCodeRecord[]`（楽天=ne_code直、Yahoo/amazon=管理番号がne_code一致 or resolver(jan,qty)で解決、未解決は除外し `unmatched` 返す）

```ts
// build.test.ts（抜粋）
import { describe, it, expect } from "vitest";
import { buildItemFromNeSet, buildMallCodes } from "./build";

it("セット: 構成展開とsuryo合算・is_set", () => {
  const { items, comps } = buildItemFromNeSet([
    { set_ne_code: "a008-4032-3", daihyo_code: "", set_name: "青切り", set_price: 6286, tax_rate: 8, component_ne_code: "a008-4032-1", suryo: 3, jan_code: "" },
  ]);
  expect(items[0]).toMatchObject({ ne_code: "a008-4032-3", is_set: true, selling_price: 6286 });
  expect(comps[0]).toMatchObject({ set_ne_code: "a008-4032-3", component_ne_code: "a008-4032-1", suryo: 3 });
});

it("楽天モールコード: ne_code直結", () => {
  const { records, unmatched } = buildMallCodes([{ manage_no: "aogiri-sh2", ne_code: "a008-4032-3", jan_code: "4582218324032", suryo: 3 }], "rakuten", () => null);
  expect(records[0]).toMatchObject({ ne_code: "a008-4032-3", mall: "rakuten", manage_no: "aogiri-sh2" });
  expect(unmatched).toBe(0);
});

it("Yahooモールコード: ne_code列なし→JAN+数量解決, 未解決はunmatched", () => {
  const resolver = (jan: string, qty: number | null) => (jan === "4582218324032" && qty === 3 ? "a008-4032-3" : null);
  const { records, unmatched } = buildMallCodes([
    { manage_no: "y1", ne_code: "", jan_code: "4582218324032", suryo: 3 },
    { manage_no: "y2", ne_code: "", jan_code: "9999999999999", suryo: 1 },
  ], "yahoo", resolver);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ ne_code: "a008-4032-3", mall: "yahoo", manage_no: "y1" });
  expect(unmatched).toBe(1);
});
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run lib/ne-master/build.test.ts` → FAIL
- [ ] **Step 3: 実装（build.ts）** — 上記契約を満たす純粋関数。
- [ ] **Step 4: 通過を確認** → PASS
- [ ] **Step 5: Commit**

```bash
git add webui/lib/ne-master/build.ts webui/lib/ne-master/build.test.ts
git commit -m "feat(ne-master): レコードビルダー(セット展開/suryo合算/モールコードJAN数量解決)"
```

---

## Task 5: リポジトリ（Supabase upsert/マージ）

**Files:**
- Create: `webui/lib/ne-master/repository.ts`

DBアクセス層。各取込APIから呼ぶ。`SupabaseClient` を受ける（既存 `lib/product/repository.ts` と同じ流儀）。

- [ ] **Step 1: 実装**

関数（すべて user_id は `auth.getUser()` から、RLSで保護）:
- `mergeItemMaster(supabase, patches, {overwrite: (keyof)[]})` … `(user_id,ne_code)` upsert。**指定列のみ更新**（excel取込はjan/cost/category/supplier/nameのみ、ne取込はselling_price/tax_rate/is_setのみ）。`sources` 配列に由来を追記。Supabaseは「列マージupsert」が無いので、(a) 既存行を ne_code 群で select → JSマージ → upsert、で実装。
- `replaceSetComposition(supabase, setNeCodes, comps)` … 対象 set_ne_code 群を delete → insert（構成変更追従）。
- `upsertMallCodes(supabase, records)` … `(user_id,ne_code,mall)` upsert。
- `mergeHimoduke(supabase, rows)` … item_master の zaiko_renkei/daihyo_code をマージ更新（行が無ければ作成）。
- 各関数は `{inserted, updated, skipped}` 的なカウントを返す。

大量件数対策: 500件ずつ chunk。

- [ ] **Step 2: 型チェック** — Run: `cd webui && npx tsc --noEmit` → エラーなし
- [ ] **Step 3: Commit**

```bash
git add webui/lib/ne-master/repository.ts
git commit -m "feat(ne-master): リポジトリ(列マージupsert/構成洗替/モールコードupsert/himodukeマージ)"
```

---

## Task 6: 取込API（ソース別・動的ルート）

**Files:**
- Create: `webui/app/api/masters/import/[source]/route.ts`

- [ ] **Step 1: 実装**

```
POST /api/masters/import/[source]   (source: ne-syohin|ne-set|ne-himoduke|excel-master|excel-discon|excel-mall)
  ?mall=rakuten|yahoo|amazon|shimanoya  (excel-mall時のみ)
FormData: file(CSV)
```

処理: `runtime="nodejs"` → auth(401) → source検証(400) → file取得(400/413, 上限8MB) → `decodeCsvBytes(await file.arrayBuffer())` → source別に `parse*` → `build*` → `repository.*` → `{ ok, source, inserted, updated, skipped, unmatched, messages[] }`。
- excel-mall の Yahoo/amazon の JAN+数量 resolver は、`ne_item_master`(jan_idx)＋楽天mall_code から (jan,qty)→ne_code を引く（取込前にロード）。
- マスタ未取込時の依存（excel-mall解決の前提）は「ベストエフォート＋unmatched報告」で許容（順不同取込）。

- [ ] **Step 2: 型チェック/ビルド** — `npx tsc --noEmit`、`npx eslint app/api/masters/import/[source]/route.ts` → クリーン
- [ ] **Step 3: Commit**

```bash
git add "webui/app/api/masters/import/[source]/route.ts"
git commit -m "feat(ne-master): ソース別CSV取込API(/api/masters/import/[source])"
```

---

## Task 7: 取込管理ページ + アップロードUI

**Files:**
- Create: `webui/app/(main)/masters/page.tsx`, `webui/components/masters/MasterImportPanel.tsx`
- Modify: `webui/components/nav/SideNav.tsx`（「マスタ取込」リンク追加）

- [ ] **Step 1: 実装** — ソース毎にファイル選択＋取込ボタン、結果（inserted/updated/skipped/unmatched）を表示。既存 `ImageUploadPanel` のトーン流用。excel-mall はモール選択付き。
- [ ] **Step 2: 型/lint/ビルド確認** — `npx tsc --noEmit`、`npx eslint`、（dev serverで表示確認）
- [ ] **Step 3: Commit**

```bash
git add "webui/app/(main)/masters/page.tsx" webui/components/masters/MasterImportPanel.tsx webui/components/nav/SideNav.tsx
git commit -m "feat(ne-master): マスタ取込管理ページ+アップロードUI"
```

---

## Task 8: Excel→CSV 変換スクリプト

**Files:**
- Create: `tools/excel_to_csv.py`

- [ ] **Step 1: 実装** — openpyxl(read_only,data_only)で `商品管理シート.xlsm` の対象シート（商品マスタ/終売品マスタ/商品コード一覧楽天/Yahoo/amazon/しまのや）をUTF-8 CSVへ出力（出力先 `docs/ネクストエンジン/from-excel/excel_*.csv`）。将来の自動DLツールはこの出力を置換する。
- [ ] **Step 2: 実行確認** — Run: `python tools/excel_to_csv.py` → 6CSV生成、件数表示（商品マスタ816等）。
- [ ] **Step 3: Commit**

```bash
git add tools/excel_to_csv.py
git commit -m "chore(ne-master): Excel商品管理シート→CSV変換スクリプト(openpyxl)"
```

---

## Task 9: 取込E2E（実DB・magic-link）

**Files:**
- Create: `webui/tests/e2e_ne_master_import.mjs`

- [ ] **Step 1: 実装** — 既存 `tests/e2e_*.mjs` のmagic-link流儀。小さな代替CSV（NE3種＋Excel代替）を作って各取込APIへPOST→3テーブルをadminで検証：
  - `a008-4032-1` の item 行（jan/売価）
  - `a008-4032-3` が is_set かつ `ne_set_composition` で component=`a008-4032-1`, suryo=3
  - 逆引き：`ne_set_composition WHERE component_ne_code='a008-4032-1'` が期待セット群
  - 楽天mall_code `aogiri-sh2`→`a008-4032-3`
  - **少なくとも1つのfixtCSVは Shift-JIS(CP932) で用意**し、decode経路を実機で通す（NEマスタは実際にCP932）。
  - 後始末：当該user_idのテスト行を全削除。
- [ ] **Step 2: 実行** — Run: `cd webui && npx tsx tests/e2e_ne_master_import.mjs`（dev server起動前提）→ 全✅
- [ ] **Step 3: Commit**

```bash
git add webui/tests/e2e_ne_master_import.mjs
git commit -m "test(ne-master): 取込E2E(3マスタ→3テーブル検証+後始末)"
```

---

## Task 10: 検証一式 + メモリ/ドキュメント更新

- [ ] **Step 1: フル検証** — `cd webui && npx tsc --noEmit && npx eslint lib/ne-master app/api/masters components/masters && npx vitest run lib/ne-master`（全緑）。実機: Task9 E2E パス。出力は `grep -v "MODULE_TYPELESS\|Reparsing\|eliminate\|trace-warnings"` で抑制。
- [ ] **Step 2: メモリ更新** — `memory/` に「統合商品マスタDB(Phase1)」の知見（テーブル/取込/正本/himoduke実態）を追記し MEMORY.md にポインタ。
- [ ] **Step 3: Commit & push**

```bash
git add -A && git commit -m "docs(ne-master): Phase1完了メモ更新" && git push origin master
```

---

## 完了条件（Phase 1）
- 3テーブル作成済み・RLS有効。
- 6ソースのCSV取込が動作（件数/未マッチ報告つき）。
- 既知データ検証（`a008-4032-1`→含むセット5件 等）がE2Eで緑。
- tsc/eslint/vitest 全緑。
- Phase 2（関連抽出・DL）は別計画。

## リスク/質問ポイント（実装中に詰まったらユーザーへ）
- Supabase 適用手順（db push の権限/接続）が不明なら確認。
- Excel→CSV のヘッダが想定と違うシートがあれば確認（列順）。
- Yahoo/amazon の JAN+数量解決で unmatched が多すぎる場合、解決ルールを再相談。
