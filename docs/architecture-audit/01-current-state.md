# 01. 現状調査（ステップ1）

すべて `webui/` を基準にした確認済みの事実。パスは特記なき限り `webui/` からの相対。推測は明示する。

## 1.1 技術スタック（確認済み）

| 分類 | 採用技術 | 根拠 |
|---|---|---|
| フレームワーク | Next.js **16.2.6**（App Router） | `package.json` |
| UI | React **19.2.4** / React DOM 19.2.4 | `package.json` |
| 言語 | TypeScript 5 | `package.json`, `tsconfig.json` |
| スタイル | Tailwind CSS 4（`@tailwindcss/postcss`）＋自前 UI（`components/ui/`） | `package.json`, `postcss.config.mjs` |
| フォーム | react-hook-form 7 ＋ `@hookform/resolvers` ＋ Zod 4 | `package.json`, `components/product/ProductForm.tsx` |
| データ/認証 | Supabase（`@supabase/ssr` 0.10, `@supabase/supabase-js` 2.106） | `lib/supabase/`, `supabase/migrations/` |
| 画像処理 | `sharp` 0.35 | `lib/image/process.ts` |
| CSV | `papaparse` 5、`iconv-lite`（cp932）、`jszip`（ZIP 同梱） | `lib/csv/`, `lib/converters/` |
| DB スクリプト | `pg` / `pg-copy-streams`（マスタ一括投入。devDependencies） | `scripts/`, `app/api/masters/import/` |
| テスト | vitest 4 ＋ Testing Library ＋ jsdom、Playwright 1.58（E2E） | `package.json`, `vitest.config.ts`, `tests/` |
| AI 連携 | Codex CLI（外部プロセス） | `lib/rule-audit/codex-client.ts` |

**グローバル状態ライブラリ（redux/zustand/jotai 等）は不採用**（`package.json` に依存なし。詳細 1.6）。

## 1.2 ディレクトリ構成（確認済み・要点）

```
webui/
  app/
    (auth)/login/            … 未ログイン用ルートグループ
    (main)/                  … 認証必須ルートグループ（layout でユーザー確認→/login redirect）
      <各画面>/page.tsx
      layout.tsx
    api/                     … Route Handlers（25本）
    auth/                    … callback / signout / dev-autologin / reset-password
    layout.tsx               … ルートレイアウト
    globals.css
  components/                … 画面部品（機能フォルダごと + ui/）
  lib/                       … ドメインロジック（機能フォルダごと・86モジュール）
  hooks/useAutoSave.ts       … 唯一のカスタムフック
  supabase/migrations/       … DDL（12テーブル）
  scripts/                   … マスタ投入等の運用スクリプト
  tests/                     … E2E/verify（.mjs/.ts、Playwright ベース）
  proxy.ts                   … 認証ミドルウェア（Next16 改称。旧 middleware.ts）
```

`lib/` のサブフォルダ（責務は 02 で詳述）: `autosave/ converters/ csv/ history/ image/ migrate/ ne-master/ preview/ product/ rakuten/ register/ rule-audit/ shopify/ supabase/ template/ yahoo/` ＋ 単体 `utils.ts`。

## 1.3 エントリーポイント（確認済み）

| 種別 | ファイル | 役割 |
|---|---|---|
| ルートレイアウト | `app/layout.tsx` | HTML 骨格・グローバル CSS |
| 認証ゲート(edge) | `proxy.ts` → `lib/supabase/middleware.ts#updateSession` | 未ログインは `/login`、ログイン済みで `/login` は `/` へ。Next16 の `proxy` 規約 |
| 認証ゲート(画面) | `app/(main)/layout.tsx` | サーバ側で `supabase.auth.getUser()`、未ログインは `redirect("/login")`。SideNav を描画 |
| 認証コールバック | `app/auth/callback/route.ts`, `app/auth/signout/route.ts`, `app/auth/dev-autologin/route.ts`, `app/auth/reset-password/page.tsx` | ログイン/ログアウト/開発用自動ログイン/パスワード再設定 |

> **middleware→proxy の確認**: git 状態は `D webui/middleware.ts` ＋ 未追跡 `webui/proxy.ts`。`proxy.ts` は `export const config = { matcher: [...] }` を持ち `updateSession` を呼ぶ。これは Next.js 16 でミドルウェアファイルが `proxy.ts` に改称された仕様への追随であり、**認証は削除されていない**（確認済み）。ただし `proxy.ts` が未追跡（未コミット）である点は要コミット。**Next16 が `proxy.ts` を自動認識する挙動そのものはバージョン依存であり、実機での有効性は要追加確認**。

## 1.4 画面とルート（`app/**/page.tsx` を全列挙・確認済み）

| ルート | ファイル | 種別 | 概要 | ナビ露出 |
|---|---|---|---|---|
| `/login` | `app/(auth)/login/page.tsx` | — | ログイン（`components/auth/LoginCard`） | 無（未ログイン時） |
| `/` | `app/(main)/page.tsx` | Server | ダッシュボード（商品数・本日編集・CSV出力・アラート・最近の履歴） | 有 |
| `/products` | `app/(main)/products/page.tsx` | Server→Client | 商品一覧（`ProductList` ＋ `MallImportByCode`）。検索・在庫フィルタ・価格インライン編集・行/一括反映・一括CSV引継ぎ | 有 |
| `/products/new` | `app/(main)/products/new/page.tsx` | Client | 新規商品作成（`NewProductClient`→`ProductEditView`）。`?template=<id>` 対応 | 有（ラベル「商品編集」） |
| `/products/[id]` | `app/(main)/products/[id]/page.tsx` | Server→Client | 既存商品編集（`ProductEditView`） | 無（一覧/履歴から） |
| `/rule-audit` | `app/(main)/rule-audit/page.tsx` | Client | ルール監査（PC販売説明文・画像名規則の違反一覧→編集導線）※未コミット | 有 |
| `/bulk-register` | `app/(main)/bulk-register/page.tsx` | Client | 一括登録（Excel風グリッド `BulkGridEditor` ＋ `BulkRegisterPanel`） | 有 |
| `/bulk-images` | `app/(main)/bulk-images/page.tsx` | Client | 画像一括アップロード（`BulkImageUploader`）※ヘルプ未掲載 | 有 |
| `/migrate` | `app/(main)/migrate/page.tsx` | Client | 楽天→Yahoo 一括移行（`MigratePanel`） | 有 |
| `/related-import` | `app/(main)/related-import/page.tsx` | Client | 関連商品（セット）取込（`RelatedImportSearch`） | 有 |
| `/csv` | `app/(main)/csv/page.tsx` | Client | CSV 一括ダウンロード（`CsvBulkDownloadForm`、5形式ZIP） | 有 |
| `/templates` | `app/(main)/templates/page.tsx` | Server→Client | テンプレート管理（`TemplateList`） | 有 |
| `/masters` | `app/(main)/masters/page.tsx` | Client | マスタ取込（`MasterImportPanel`、NE/Excel→統合台帳） | 有 |
| `/masters/related` | `app/(main)/masters/related/page.tsx` | Client | 関連商品抽出（`RelatedSearchPanel`） | 有 |
| `/history` | `app/(main)/history/page.tsx` | Server→Client | 作業履歴（`HistoryView`、種別/コード/期間フィルタ） | 有 |
| `/settings` | `app/(main)/settings/page.tsx` | — | **プレースホルダ**（「Plan 5 で実装予定」） | 有 |
| `/help` | `app/(main)/help/page.tsx` | — | ヘルプ（画面手順・失敗集・用語集・技術仕様） | 有 |
| `/auth/reset-password` | `app/auth/reset-password/page.tsx` | Client | パスワード再設定 | 無 |

- **画面 page.tsx 総数 = 18**（実測）。うちナビ露出15、ダッシュボードからのみ辿る `/products/[id]`、`/auth/reset-password`、`/login` を除くと SideNav 15項目と整合。
- **不一致**: `/settings` は空実装だがナビ・ヘルプに掲載。`/rule-audit`・`/bulk-images` はナビにあるがヘルプ `SCREEN_TOC` に無い（`help/page.tsx`）。

## 1.5 API エンドポイント（`app/api/**/route.ts` を全列挙・25本）

> 各行の詳細（呼び出す lib・重複関係）は `02-feature-ledger.md` の機能台帳と重複調査で扱う。網羅とメソッドは実測（`find app/api -name route.ts` ＋ `grep "export (async )?function (GET|POST|…)"` 各ファイル）。
> **GET+POST の2本立ては「GET=dry-run プレビュー / POST=本実行」の共通パターン**（fetch・update・register 単品系）。

| # | ルート | メソッド | 系統 | 外部サービス（推定） |
|---|---|---|---|---|
| 1 | `api/fetch/[mall]/[id]` | GET, POST | 取込（モール現物→アプリ） | 楽天/Yahoo/Shopify |
| 2 | `api/import/[mall]` | POST | 取込（コード指定インポート） | 楽天/Yahoo/Shopify |
| 3 | `api/update/[mall]/[id]` | GET, POST | 反映（部分更新） | 楽天/Yahoo/Shopify |
| 4 | `api/register/rakuten/[id]` | GET, POST | 反映（新規登録・楽天） | 楽天 RMS |
| 5 | `api/register/yahoo/[id]` | GET, POST | 反映（新規登録・Yahoo） | Yahoo |
| 6 | `api/register/bulk/[mall]` | POST | 反映（一括登録） | 楽天/Yahoo |
| 7 | `api/products/[id]/price` | POST | 反映（価格のみ更新） | 楽天/Yahoo |
| 8 | `api/csv/[mall]/[id]` | GET | CSV（単品） | Supabase のみ |
| 9 | `api/csv/bulk` | POST | CSV（一括・5形式ZIP） | Supabase のみ |
| 10 | `api/upload/rcabinet` | POST | 画像（楽天R-Cabinetへ） | 楽天 R-Cabinet |
| 11 | `api/upload/rcabinet-sync/[id]` | POST | 画像（取込画像→R-Cabinet同期） | 楽天 R-Cabinet |
| 12 | `api/upload/yahoo` | POST | 画像（Yahoo lib へ） | Yahoo |
| 13 | `api/upload/yahoo-sync/[id]` | POST | 画像（取込画像→Yahoo lib同期） | Yahoo |
| 14 | `api/upload/bulk-image` | POST | 画像（一括アップロード） | 楽天/Yahoo/Shopify |
| 15 | `api/rakuten/item-images` | GET | 楽天 商品画像取得 | 楽天 |
| 16 | `api/rcabinet/folders` | GET | R-Cabinet フォルダ一覧 | 楽天 R-Cabinet |
| 17 | `api/migrate/rakuten-to-yahoo` | POST | 移行（楽天→Yahoo一括） | 楽天＋Yahoo |
| 18 | `api/masters/import/[source]` | POST | マスタ取込（NE/Excel） | Supabase（pg 直結） |
| 19 | `api/masters/related` | POST | 関連商品抽出クエリ | Supabase |
| 20 | `api/rule-audit` | GET | ルール監査スキャン | Supabase |
| 21 | `api/products/[id]/codex-normalize` | POST | Codex 正規化提案 | Codex CLI |
| 22 | `api/products/research-import` | POST | 商品リサーチ取込・**UI非経由** | Supabase（外部スキル起動） |
| 23 | `api/auth/callback`(`app/auth/callback`) | GET | 認証 | Supabase |
| 24 | `api/auth/signout`(`app/auth/signout`) | POST | 認証 | Supabase |
| 25 | `api/auth/dev-autologin`(`app/auth/dev-autologin`) | GET | 開発用自動ログイン | Supabase |

> 20〜22 は監査時点で未コミットだったが、**M0（コミット d477062）で確定済み**。

- **route.ts 総数 = 25**（実測。上表の auth 3本を含む）。
- **`research-import` は webui UI から呼ばれていない**（確認済み: `grep -rn research-import components app | grep fetch` = 0件）。呼び出し元は外部スキル `.agents/skills/product-research-autofill/`（確認済み）。→ **「未使用」と断定してはならない**外部連携エンドポイント。

## 1.6 状態管理（確認済み）

- **グローバルストア無し**。redux/zustand/jotai は `package.json` に無く、`createContext`/`Provider` によるアプリ全体状態も未使用（画面はそれぞれ独立してサーバ/APIから取得）。
- **サーバ取得**: Server Component が `lib/supabase/server.ts#createClient` で直接 Supabase を読み、`ProductList`/`HistoryView`/`TemplateList` 等へ `initial` を props で渡す。
- **フォーム状態**: `components/product/ProductForm.tsx` が react-hook-form（`zodResolver(ProductInputBaseSchema)`）。編集ハブ `ProductEditView` が `onChange` で親 state に反映しプレビューへ配る。
- **自動保存**: `hooks/useAutoSave.ts` ＋ 純粋状態機械 `lib/autosave/machine.ts`（デバウンス保存・失敗リトライ・離脱ガード）。**副作用とロジックの分離が効いた良い設計**（参考にすべきパターン）。
- **例外（要注意）**: `ProductForm.tsx` 冒頭にモジュールスコープの `whiteBgUploadListeners`（Set）による React 外 pub/sub。暗黙のグローバル状態で、07 の禁止パターン対象。

## 1.7 データ保存（確認済み）

Supabase Postgres。DDL は `supabase/migrations/`（12テーブル）。RLS で `auth.uid() = user_id` を全ユーザーデータに強制（`20260524000006_rls_policies.sql`）。

| テーブル | 役割 | 備考 |
|---|---|---|
| `products` | 商品本体。**主要25列＋`extra` JSONB** | `(user_id, ne_code)` UNIQUE。`repository.ts` が主要列/extra を分割保存 |
| `settings` | 店舗ID等のユーザー設定 | 画面（`/settings`）は未実装だがテーブルは存在 |
| `maker_codes` | メーカーコードマスタ | |
| `history` | 操作履歴（create/edit/csv_export/delete） | `product_id` は ON DELETE SET NULL |
| `product_templates` | テンプレート（`template_data` JSONB） | |
| `rakuten_genre_attributes` | 楽天ジャンル別 必須属性（全ユーザー共通・読取専用） | 投入は `scripts/import_genre_attributes.mjs` |
| `rakuten_yahoo_category_mapping` | 楽天ジャンル→Yahooカテゴリ対応（共通・読取専用） | migrate で使用 |
| `rakuten_yahoo_shipping_mapping` / `..._leadtime_mapping` | 移行時の配送/納期対応（共通） | |
| `ne_item_master` / `ne_set_composition` / `ne_mall_code` | 統合商品マスタ（NE+Excel、`ne_code` スパイン） | `/masters`・`lib/ne-master/` |

- **保存契約の要**: 「主要25列以外は `extra` JSONB に往復」（`repository.ts` の `MAIN_COLUMNS`）。`ProductInputSchema`（`lib/product/schema.ts`）が正本で、`extra` に `yahoo_rewrite`/`shopify_overrides`/`variants[]`/画像URL等が入る。**互換性の中心**であり、リファクタ時に最優先で保護する（05・07）。

## 1.8 外部サービス連携（確認済み）

| サービス | クライアント層 | 認証 | 用途 |
|---|---|---|---|
| 楽天 RMS | `lib/rakuten/`（`item-client` `inventory-client` `cabinet-client` `credentials` `store` `qps-retry`） | `credentials.ts` | 商品登録・更新・在庫・R-Cabinet画像・QPS制御 |
| Yahoo!ショッピング | `lib/yahoo/`（`auth` `item-client` `item-image-client` `lib-image-client` `item-mapper` `subscription` `variation-params`） | `auth.ts`（トークンキャッシュ） | editItem 登録・更新・画像lib・定期購入 |
| Shopify | `lib/shopify/`（`auth` `graphql-client` `product-client` `inventory-client` `media-client`） | `auth.ts` | GraphQL 商品/在庫/メディア |
| ネクストエンジン(NE) | **API クライアント無し**。`lib/converters/ne.ts` ＋ `lib/ne-master/` | — | **CSV 出力のみ**（API 直接登録は未実装。`docs/spec.md` §5.3 の将来項目） |
| Supabase | `lib/supabase/`（`client`/`server`/`middleware`） | Cookie(SSR) | Auth・DB・RLS |
| Codex CLI | `lib/rule-audit/codex-client.ts` | ローカル CLI | ルール正規化提案・リサーチ |

- **モール間クライアント構造は非対称**（楽天=多クライアント、Yahoo=mapper志向、Shopify=GraphQL単一、NE=CSVのみ）。命名も不揃い（04・07 で整理方針）。

## 1.9 テスト構成（確認済み）

- **単体/コンポーネント**: vitest **121ファイル**（`*.test.ts(x)`。`lib/converters/` `lib/product/` `lib/migrate/` `lib/yahoo/` に厚い）。`vitest.config.ts` ＋ jsdom。
- **E2E/verify**: `webui/tests/` に `e2e_*.mjs|ts`（登録・取込・更新・移行・画像同期・多SKU 等）と `verify_*.mjs`（パーサ/パッチ/変換の実データ照合）。Playwright ベース。`tests/setup.ts`・`tests/fixtures/`・`run_e2e_repeat.mjs`。
- **旧 Python 側**: リポジトリ直下 `tests/`（`test_*.py`、pytest）。Phase 1 CLI 用。webui とは独立。
- **保護**: テスト/spec/lint/tsconfig/settings は deny＋PreToolUse guard で保護（報酬ハッキング防止）。→ 回帰テストは「既存を書き換えず新規追加」方針（06）。

### 未確認・要追加確認メモ
- 各 API route の正確なメソッド・内部呼び出しは 02 の台帳で確定（本書はルート網羅に留める）。
- `proxy.ts` が Next16 実機で有効化されているか（ビルド/デプロイ設定）。
- 旧 Python CLI が現在も定常運用されているか（02「廃止候補」で判定・要ヒアリング）。
