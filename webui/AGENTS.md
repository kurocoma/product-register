# AGENTS.md — webui 恒久ルール（AI コーディングエージェント向け）

対象: このフォルダ（Next.js 16 App Router / React 19 / TypeScript / Supabase / Zod / react-hook-form / vitest）。
背景と根拠は `../docs/architecture-audit/`（特に 04=目標構成・05=移行計画・07=本ルールの原案）。

## 配置ルール（どこに置くか）

| 追加するもの | 置き場所 | 禁止 |
|---|---|---|
| 画面（ルート） | `app/(main)/<route>/page.tsx`（認証必須）。UI 本体は `components/<feature>/` | `app/` に業務ロジック本体 |
| API | `app/api/<系統>/…/route.ts`。系統は `fetch`/`import`/`update`/`register`/`upload`/`csv`/`migrate`/`masters` を踏襲 | 新系統名を独断で増やす |
| ドメインロジック | `lib/<feature>/`（`product`/`converters`/`register`/`migrate`/`rule-audit`/`csv`/`ne-master` 等） | `components/`・`app/` にロジック本体 |
| モール外部API呼び出し | `lib/rakuten/`・`lib/yahoo/`・`lib/shopify/` のクライアント層のみ | components/route から直接 fetch |
| DB アクセス | `lib/product/repository.ts` 等の repository、または `lib/supabase/` 経由 | コンポーネントから任意テーブル直クエリ（読取専用の Server Component を除く） |
| フック | `hooks/`。副作用のない判定は `lib/` の純関数へ（`lib/autosave/machine.ts` が手本） | UI に状態機械ロジック直書き |
| テスト | 対象の隣に `*.test.ts(x)`（**新規作成のみ可**） | 既存テスト・tsconfig・eslint・settings の改変（実装を直す） |

## import ルール（barrel = 公開境界）

- 各 `lib/<feature>/index.ts` が公開境界。**他機能・API ルートからは barrel（`@/lib/<feature>`）だけを import** し、内部ファイル（`@/lib/<feature>/xxx`）を直接掴まない。
- 例外（意図的に barrel なし・直 import を維持）:
  - `@/lib/supabase/{server,client,middleware}` — server/client 境界が混在するため束ねない。
  - `@/lib/migrate/executor` — `lib/migrate/index.ts` は純ロジック層のみを公開する設計。
- **クライアントコンポーネントの注意**: サーバ専用コード（sharp・Codex CLI・モール認証）を含む barrel（`@/lib/image`、`@/lib/rule-audit`、`@/lib/register`、`@/lib/rakuten|yahoo|shopify`）をクライアントから import しない。純ロジック（`register/bulk-plan` 等）が必要なときのみ当該純モジュールを直 import してよい（経過措置。barrel 冒頭コメント参照）。
- 依存方向は下位のみ: `app/ → components/ → lib/<feature>/ → lib/<mall>クライアント・lib/supabase・lib/product/schema`。`lib/` から `components/`・`app/` を import しない。**循環依存禁止**。
- モール変換の命名契約: `parse(取込)` / `toCsv(出力)` / `buildPatch(差分)` / `buildPayload(登録)` の4動詞に揃える（新モールもこの形）。

## shared / utils へ移動してよい条件

`lib/shared/`（schema・utils の re-export）と `lib/utils.ts` を肥大させない。共通化は次を**すべて**満たすときのみ:
(1) 2つ以上の機能が実際に使用 (2) 業務的に同一概念 (3) 副作用なし or 明確な境界。
モール固有の値・分岐（税率丸め等）は `shared` に置かず各モール層に留める。迷ったら機能フォルダ内に置く（重複を許容）。

## 状態管理ルール

- **グローバルストア（redux/zustand 等）を導入しない**。画面ローカル state ＋ react-hook-form ＋ `lib/autosave/machine.ts` で足りている。
- サーバ初期データは Server Component で取得→ `initial*` props（`ProductList`/`HistoryView` の踏襲）。
- **React 外の可変グローバル（モジュールスコープ Set/Map の pub/sub）を新設しない**。`ProductForm.tsx` の `whiteBgUploadListeners` は既存負債（増やさない・監査 M10 で解消予定）。

## データアクセスルール

- 書き込みは repository 経由（`upsertProduct`/`deleteProduct`）。履歴（`recordHistory`）と検証を通す。
- **`products.extra` JSONB 契約を壊さない**: 主要列は `MAIN_COLUMNS`、残りは `extra` 往復。列追加は migration ＋ `MAIN_COLUMNS` ＋ `schema.ts` ＋ 往復テストをセットで。
- 参照マスタ（`rakuten_genre_attributes` 等）は読取専用。RLS（`auth.uid()=user_id`）前提を崩さず、service role をクライアントへ出さない。

## 新機能を追加する前の確認（順に自問）

1. 同じ目的の既存機能はないか（`../docs/architecture-audit/02` の機能台帳。単品/一括の二重化を増やさない）
2. 既存 `app/api/<系統>` のどれに属するか
3. 既存 `lib/<feature>` のどれに属するか（無ければ最小の新フォルダ＋barrel）
4. `ProductInput`（schema）への項目追加が要るか（要るなら migration・往復テストまでセット）
5. ナビ（`components/nav/SideNav.tsx`）とヘルプ（`app/(main)/help/page.tsx` の `SCREEN_TOC`）を**同時に**更新
6. 破壊的操作なら dry-run（お試し実行）を用意

## リファクタリング時の制約

- 一括リライト禁止。機能単位の小ステップ（`../docs/architecture-audit/05` の順序）で、各ステップ後にテスト緑。
- ロジック移動の前に characterization テストを**新規作成**（既存テスト改変は不可）。
- 旧実装の削除は互換 re-export（アダプタ）を挟み、呼び出し元・外部参照（`.agents/` の skill・CLI・バッチ）を grep 確認後に段階廃止。
- **`app/api/products/research-import` の URL・契約は凍結**（外部 skill `product-research-autofill` が呼ぶ。削除禁止）。

## 後方互換ルール

- 既存 URL・API パス/メソッド/レスポンス・CSV 列/エンコーディング・`extra` JSONB を変えない（変えるならバージョン付き新設＋移行期間）。
- 旧固定枠（`attribute_*_1..5`・フラット単一SKU）は新規で使わないが**読取は維持**（`resolveAttributes`/`productVariants` のフォールバックを残す）。

## 禁止パターン（明示）

- 新しいグローバル状態（ストア／モジュールスコープ可変／React 外 pub/sub）の追加
- `shared`・`utils` への「何でも移動」
- 既存機能と重複する新機能（単品/一括のさらなる分岐、カテゴリ支援の4つ目の実装 等）
- 無関係ファイルの同時変更・巨大 PR
- テストなしの大規模変更／テスト・設定書き換えによる「合格」
- components/route からのモール API 直 fetch・任意テーブル直クエリ
- `ProductForm.tsx`（1200行超）へのさらなる追記（新セクションは子コンポーネントへ）

## 作業完了時の報告形式

変更点（ファイル単位）／検証手順と結果（lint・tsc・vitest・該当 E2E のログ）／互換性影響（URL・API・保存データ・CSV に触れたか）／ロールバック方法（revert 単位）／未確認事項（「要追加確認」と明示）を必ず記載する。
