# 04. コード構造（ステップ5 ／ 最終出力6・7）

原則: **feature-first / 明示的な公開インターフェース / 別機能の内部ファイルを直接importしない / shared最小限 / DB・ファイル・HTTP・外部APIに境界 / UIに業務ロジックを集中させない / グローバル状態最小限 / 循環依存禁止 / 機能単位で移行**。

**重要な前提（確認済みの良い点）**: 現状の `lib/` は既に機能フォルダ分割済みで、`lib → components/app` の逆流は無く（確認済み）、`lib/product/schema` を共有ドメイン核とした概ね層状の依存になっている。**大改造は不要**で、目標は「(1) 公開境界(barrel)の明示、(2) mall 単位の命名統一、(3) UI からロジック分離、(4) shared の定義」の4点に絞る。

## 5.1 現状の依存構造（実測サマリ）

- `lib/product/schema`（`ProductInput`）が **共有核**。`lib/converters` 内だけで 32 箇所が import（`grep` 実測）。
- 層状の主な向き（非テスト・確認済み）:
  `converters → product/schema, product/diff`（一方向）、`yahoo → converters`（一方向）、`register/migrate/rule-audit/csv → converters + product`、`rakuten/shopify/ne-master/image/supabase/history/template/autosave` は **他機能へ依存しない葉モジュール**。
- **循環依存は非テストコードでは未検出**（`converters ↔ product`、`converters ↔ yahoo` はいずれも一方向。逆向きはテストファイルのみ）。ただし barrel/境界が無いため将来の循環は起きやすい → ルールで予防。
- **層違反は1件のみ**: `components/product/MigratePanel.tsx` が `@/lib/yahoo/item-mapper#countYahooField`（純関数ヘルパ）を直 import。API クライアントではないが、境界としては UI→mall 直参照。是正候補。

## 5.2 推奨ディレクトリ構成（目標・feature-first）

既存を活かし、**barrel と mall グルーピングを足す**形。破壊的移動は最小限（5.6 で段階化）。

```
webui/
  app/                         … ルーティングと薄いエントリのみ（ロジック禁止）
    (main)/… route ごとに page.tsx（describe: どの feature を呼ぶか）
    api/…   route.ts はリクエスト整形＋feature 呼び出しのみ（薄く保つ）
  components/                  … 表示。feature ごとにフォルダ。UIは状態と描画のみ
    product/ preview/ bulk-images/ csv/ masters/ history/ templates/ settings/ auth/ nav/
    ui/                        … 汎用プリミティブ（button/card/input/accordion）
  hooks/                       … React フック（副作用ラッパ。ロジックは lib/ の純関数へ）
  lib/
    shared/                    ← 【新設・最小】全 feature が依存してよい唯一の共有
      schema.ts   (現 product/schema.ts を昇格)  … ProductInput 契約＝ドメイン核
      types.ts    (register/types, migrate/types 等の横断型を集約する場合)
      utils.ts    (現 lib/utils.ts の cn 等)
    product/                   … 商品ドメイン（repository, diff, variants, search, grid-rows,
                                  category-*, html-sanitize, text-fit …）＋ index.ts
    malls/                     ← 【再編】モール単位に converters+client を集約
      rakuten/  (parse / csv / patch / payload(api) / tax / client(cabinet,item,inventory) / index.ts)
      yahoo/    (parse / csv / patch / mapper / subscription / image-client / auth / index.ts)
      shopify/  (parse / csv / patch / client(product,media,inventory) / auth / index.ts)
      ne/       (csv(ne.ts) / ne-master(build,parse,related,repository) / index.ts)
      shared/   (base.ts, mall-import.ts, image-url.ts, cabinet-path.ts — モール横断の変換基盤)
    register/ migrate/ rule-audit/ csv/ image/ preview/ history/ template/ autosave/  … 各 index.ts
    supabase/                  … Supabase クライアント境界（client/server/middleware）
```

> `lib/malls/` は **現 `lib/converters/*` と `lib/rakuten|yahoo|shopify/` の物理再配置**であり、責務は変えない。移動は 05 の最後半で（barrel が入ってから）行う低リスク作業。当面は「論理グルーピング＝barrel」で表現し、物理移動は任意。

## 5.3 各ディレクトリの責務（置くもの / 置かないもの）

| ディレクトリ | 置く | 置かない |
|---|---|---|
| `app/` | ルーティング、リクエスト/レスポンス整形、feature 呼び出し | 変換・登録・DBロジック本体 |
| `components/` | 表示・入力・ローカルUI状態 | 業務計算、外部API直呼び、DB直クエリ（読取Server除く） |
| `hooks/` | React 副作用のラッパ | 純粋な判定/状態遷移ロジック（→ `lib/` の純関数へ） |
| `lib/shared/` | `ProductInput` スキーマ、横断型、`cn` 等の無害ユーティリティ | モール固有分岐、DB/HTTP、機能固有ロジック |
| `lib/product/` | 商品ドメイン（保存・検証・派生・グリッド・カテゴリ・サニタイズ） | モールAPI呼び出し、UI |
| `lib/malls/<mall>/` | 取込パース・CSV・パッチ・登録ペイロード・そのモールのAPIクライアント・税 | 他モールの分岐、UI、DB書込 |
| `lib/register/` `migrate/` `rule-audit/` | ユースケース（複数モール/複数商品を束ねる手続き） | 低レベルHTTP（→ malls クライアント経由） |
| `lib/supabase/` | Supabase 接続の唯一の境界 | 業務ロジック |

## 5.4 モジュール境界（公開インターフェース）

- 各 `lib/<feature>/` に **`index.ts`（barrel）** を置き、外部が使う関数/型だけを再export。
- 他 feature からは **barrel のみ** import（`@/lib/malls/yahoo` は可、`@/lib/malls/yahoo/mapper` を外部が直掴みは不可）。
- モール変換は **共通4動詞に統一**（命名不揃いの解消）:
  - `parse(raw) → ProductInput`（現 `*-item-parser.ts`）
  - `toCsv(ProductInput) → string`（現 `rakuten.ts`/`yahoo.ts`/`shopify.ts`/`ne.ts`）
  - `buildPatch(current, ProductInput) → Patch`（現 `*-patch.ts`）
  - `buildPayload(ProductInput) → ApiPayload`（現 `rakuten-api.ts`/`yahoo item-mapper` 等）
- クライアント層（`item-client`/`graphql-client`/`cabinet-client`）は feature の barrel から**外部露出しない**（register/migrate 経由で使う）。

## 5.5 依存関係ルール（許可 / 禁止）

許可（上→下の一方向のみ）:
```
app  ─▶ components ─▶ hooks ─▶ lib/<feature>(barrel) ─▶ lib/malls/<mall>(barrel) ─▶ lib/supabase
                                        └────────────▶ lib/shared (schema/types/utils)
```
禁止:
- `lib/*` から `components/*`・`app/*` を import（現状も違反なし＝維持）。
- feature 間の **内部ファイル直 import**（barrel 経由へ）。
- **循環依存**（barrel 化で機械的に検出可能に。`converters↔product` 逆流をテスト以外で作らない）。
- `components`/`app` から **mall クライアント直呼び**（現 `MigratePanel.tsx` の `countYahooField` 直参照は是正: `lib/malls/yahoo` barrel か `lib/product` の表示用ヘルパへ移す）。
- `lib/shared` に **モール固有ロジックを入れない**（shared 最小限）。

## 5.6 現在ファイル → 新構成 対応表（抜粋・代表）

> 全86 lib＋37 componentsのうち、移動判断が要る代表を挙げる。**大半は「現位置のまま barrel を足すだけ」**（移動リスク=なし）。

| 現在のファイル | 移動先候補 | 理由 | 移行リスク |
|---|---|---|---|
| `lib/product/schema.ts` | `lib/shared/schema.ts`（別名 re-export で互換） | 全 feature の共有核。shared の中心 | 中（import 元多数→barrel/別名で吸収） |
| `lib/utils.ts` | `lib/shared/utils.ts` | 汎用ユーティリティ | 低 |
| `lib/converters/rakuten*.ts` `rakuten-tax.ts` | `lib/malls/rakuten/{csv,patch,parse,payload,tax}` | mall 単位集約・4動詞命名 | 中（物理移動。barrel後に） |
| `lib/converters/yahoo*.ts` | `lib/malls/yahoo/{csv,patch,parse}` | 同上 | 中 |
| `lib/converters/shopify*.ts` | `lib/malls/shopify/{csv,patch,parse}` | 同上 | 中 |
| `lib/converters/ne.ts` | `lib/malls/ne/csv.ts` | 同上 | 低 |
| `lib/converters/base.ts` `mall-import.ts` `image-url.ts` `cabinet-path.ts` | `lib/malls/shared/` | モール横断の変換基盤 | 低〜中 |
| `lib/rakuten/*` | `lib/malls/rakuten/client/*` | クライアントを mall 配下へ | 低（葉モジュール） |
| `lib/yahoo/*` | `lib/malls/yahoo/*`（client/mapper/auth/subscription） | 同上 | 低 |
| `lib/shopify/*` | `lib/malls/shopify/client/*` | 同上 | 低 |
| `lib/ne-master/*` | `lib/malls/ne/master/*` | NE 台帳を NE 配下へ | 低 |
| `lib/product/category-assist.ts` / `category-autofill.ts` / `category-mapping.ts` | `lib/product/category/`（統合後に正本1つ＋薄いアダプタ） | カテゴリ支援の分散を集約（02の重複判定に従う） | 中（重複統合。要characterizationテスト） |
| `components/product/ProductForm.tsx`(1223行) | `components/product/form/`（section 別に分割: BasicSection/VariantsSection/…） | UIからロジック分離・肥大解消 | 中〜高（大コンポーネント分割。段階的に） |
| `ProductForm.tsx` の `whiteBgUploadListeners` | `hooks/` or context へ明示化 | React外グローバルの解消 | 中 |
| `components/product/MigratePanel.tsx` の mall直import | `lib/malls/yahoo` barrel 経由へ | 層違反是正 | 低 |
| `src/product_register/**`（Python） | 別リポ/`legacy/` へ隔離 or 廃止（要確認） | webui へ機能移行済みの旧実装 | 中（02の廃止候補で判定） |

## 5.7 移行順序（依存が少なくリスク低い順）

1. **葉モジュールの barrel 追加**（`rakuten`/`shopify`/`ne-master`/`image`/`supabase`/`history`/`template`/`autosave`）— 他へ依存せず影響小。
2. **`lib/shared/` 新設**：`schema.ts`・`utils.ts` を re-export 別名で移す（旧パスは互換 re-export を残す）。
3. **feature barrel 追加**（`product`/`converters`/`register`/`migrate`/`rule-audit`/`csv`/`preview`）＋ 外部 import を barrel へ差し替え。
4. **命名4動詞への内部リネーム**（`*-item-parser`→`parse` 等。まず re-export で両名維持）。
5. **`lib/malls/` への物理集約**（barrel が入っているので import 変更が局所化）。
6. **カテゴリ支援の統合**（02 の判定に従い正本化）。
7. **`ProductForm.tsx` のセクション分割**・`whiteBgUploadListeners` 明示化。
8. **層違反是正**（`MigratePanel`）。
9. **旧 Python CLI の隔離/廃止**（02・要確認後）。

## 5.8 互換性維持方法（import / URL / API / 保存データを壊さない）

- **import 互換**: 物理移動時は旧パスに `export * from "新パス"` の**互換 re-export** を残し、段階的に呼び出し元を移す（一括置換しない）。
- **URL/API 互換**: `app/` のルート・`api/` の URL/メソッド/レスポンスは変えない（本ドキュメントの再編は `lib/` と `components/` 内部に限定）。
- **保存データ互換**: `products.extra` JSONB 契約（`MAIN_COLUMNS` と `schema.ts`）を不変に保つ。`schema.ts` を shared へ移す際も **型・フィールド・default を変更しない**（位置だけ移動）。
- **後方互換フィールド維持**: 旧 `attribute_*_1..5`／フラット単一SKU のフォールバック（`resolveAttributes`/`productVariants`）は残す。
- 各ステップ後に **vitest 緑＋該当 E2E** を確認（06）。1ステップ=1PR=revert 可能。
