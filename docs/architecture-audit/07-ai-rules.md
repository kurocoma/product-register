# 07. AI向けプロジェクトルール案（ステップ8 ／ 最終出力12）

AI コーディングエージェント（Claude Code / Codex 等）が本リポジトリで暴走しないための恒久ルール **案**。
**配置案**（この段階では実ファイルへ書き込まない）:
- リポジトリ横断の原則 → `webui/AGENTS.md`（新規）または `webui/CLAUDE.md` へ。
- 機能フォルダ固有の注意 → 各 `webui/lib/<feature>/README.md`（1〜3行）。
- 既存 `C:/Users/hppym/.claude/CLAUDE.md` / `C:/Users/hppym/dev/.claude/CLAUDE.md` の「地図」からポインタを張る。

抽象論を避け、実在するディレクトリ名・技術（Next.js 16 App Router / React 19 / Supabase / Zod / react-hook-form / vitest）に即して書く。

## 8.1 ディレクトリ配置ルール（どこに置くか）

| 追加するもの | 置き場所 | 禁止 |
|---|---|---|
| 画面（ルート） | `app/(main)/<route>/page.tsx`（認証必須）。UI は `components/<feature>/` へ | `app/` に業務ロジックを書く |
| API | `app/api/<系統>/…/route.ts`。系統は既存12系統（`fetch`/`import`/`update`/`register`/`upload`/`csv`/`migrate`/`masters`/`products`/`rakuten`/`rcabinet`/`rule-audit`。01 §1.5 に全列挙）を踏襲 | 新しい系統名を独断で増やす |
| ドメインロジック | `lib/<feature>/`（`converters`/`register`/`migrate`/`product`/`rakuten`/`yahoo`/`shopify`/`ne-master` 等） | `components/` や `app/` にロジック本体を書く |
| 外部API呼び出し | `lib/<mall>/`（`rakuten`/`yahoo`/`shopify`）のクライアント層のみ | `components`/`app`/`converters` から直接 fetch する |
| DB アクセス | `lib/product/repository.ts` 等の repository、または `lib/supabase/` 経由 | コンポーネントから任意テーブルを直接クエリ（読取の Server Component 除く） |
| フック | `hooks/`。ただし副作用のない判定ロジックは `lib/` の純関数へ | UI に状態機械ロジックを直書き（`lib/autosave/machine.ts` の分離を手本に） |
| テスト | 対象ファイルの隣に `*.test.ts(x)`（新規作成のみ可） | **既存テスト/spec/tsconfig/lint/settings の改変**（deny＋guard で保護。実装を直す） |

## 8.2 機能モジュールの境界（公開インターフェース）

- 各 `lib/<feature>/` は **公開する関数/型を `index.ts`（barrel）に明示** する（未整備。04 の移行で整備）。
- 他機能からは **`lib/<feature>`（barrel）だけを import**。`lib/<feature>/internal-xxx.ts` を直接 import しない。
- モール変換は共通契約に従う: `parse(取込) → ProductInput` / `toCsv(ProductInput) → CSV` / `buildPatch(現物, ProductInput) → 差分` / `buildPayload(ProductInput) → 登録`。**新モール・新機能もこの4動詞に合わせる**（命名の不揃いを止める）。

## 8.3 import ルール（依存の許可/禁止）

許可（下位方向のみ）:
```
app/ ─▶ components/ ─▶ lib/<feature>/ ─▶ lib/<mall>クライアント / lib/supabase / lib/(shared)
                                   └────▶ lib/product/schema（共通ドメイン型）
```
禁止:
- `lib/` から `components/` や `app/` を import（下位が上位を知る）。
- 機能フォルダ間の **横 import で内部ファイルを掴む**（barrel 経由のみ）。
- **循環依存**（`converters ⇄ register` 等）。追加時に依存方向を確認。
- コンポーネント/route から **モール外部API を直接 fetch**（必ず `lib/<mall>/` 経由）。

## 8.4 shared / utils へ移動してよい条件

- `lib/utils.ts` は現状 `cn()` のみ（健全）。**「とりあえず共通化」で肥大させない**。
- 共通化してよいのは全て満たすとき: (1) **2つ以上の機能が実際に使用**、(2) **業務的に同一の概念**（見た目が似ているだけの別概念は統合しない）、(3) 副作用なし or 明確な境界（DB/HTTP/ファイル）。
- モール固有の値・分岐を `shared` に置かない（楽天の税率0.1変換は `lib/converters/rakuten-tax` に留める）。
- 迷ったら **機能フォルダ内に置く**（過度な共通化より重複を許容）。

## 8.5 状態管理ルール

- **グローバルストアを新規導入しない**（redux/zustand 等）。現状は画面ローカル state ＋ react-hook-form ＋ 自動保存状態機械で足りている。
- サーバから初期データを渡すときは **Server Component で取得→props**（`ProductList`/`HistoryView` の踏襲）。
- **React 外の可変グローバル（モジュールスコープの Set/Map による pub/sub）を新設しない**。`ProductForm.tsx` の `whiteBgUploadListeners` は既存の負債で、増やさない（将来は context かイベントを props で明示）。

## 8.6 データアクセスルール

- 書き込みは **repository 経由**（`lib/product/repository.ts` の `upsertProduct`/`deleteProduct`）。履歴記録（`recordHistory`）と検証（`validateForSave`）を通す。
- **`products.extra` JSONB の契約を壊さない**: 主要25列は `MAIN_COLUMNS`、それ以外は `extra` に往復（`repository.ts`）。列を増やすときは migration ＋ `MAIN_COLUMNS` ＋ `schema.ts` を同時に更新し、既存レコードの往復テストを追加。
- 参照マスタ（`rakuten_genre_attributes` 等）は **読取専用**。書き込みは `scripts/` の運用スクリプト経由。
- RLS 前提（`auth.uid()=user_id`）を崩さない。service role をクライアントに露出しない。

## 8.7 新機能追加前の確認事項（チェックリスト）

1. **同じ目的の既存機能はないか**（単品版/一括版の二重化を増やさない。02の機能台帳を確認）。
2. どの `app/api/<系統>` に属するか（新系統を作らない）。
3. どの `lib/<feature>` に属するか。無ければ最小の新フォルダ＋barrel。
4. `ProductInput`（`schema.ts`）に項目追加が要るか。要るなら migration・`MAIN_COLUMNS`・往復テストまでセット。
5. 外部API を叩くなら該当 `lib/<mall>/` クライアントに追加（route から直呼びしない）。
6. ナビ（`SideNav.tsx`）とヘルプ（`help/page.tsx` の `SCREEN_TOC`）を**同時に**更新（現状の不一致を再発させない）。
7. dry-run（お試し実行）を持つ操作か。破壊的操作なら dry-run を用意。

## 8.8 リファクタリング時の制約

- **一括リライト禁止**。機能単位の小ステップ（05 の順序）で、各ステップ後にテスト緑を確認。
- **推測で仕様変更しない**。不明は「要確認」でコメント化し、既存の後方互換（旧属性1..5／フラット↔variants）を勝手に削らない。
- **無関係ファイルを"ついでに"変更しない**（1PR=1機能移動）。
- 旧実装を消す前に **互換アダプタ**を挟み、呼び出し元・外部参照（skill/CLI/バッチ）を grep で確認してから段階廃止。
- URL・API・保存データ・CSV列を変えるときは 06 の互換チェックリストを通す。

## 8.9 テスト要件

- ロジック移動は **移動前に characterization test を新規作成**（既存改変不可）→ 移動後も緑を維持。
- API/変換の変更は 異常系・境界値・データ互換を必ず含める（06 のマトリクス準拠）。
- **テストを通すためにテスト/設定を書き換えない**（報酬ハッキング禁止。実装を直す）。

## 8.10 後方互換ルール

- `products.extra` の読み書き互換を最優先（既存レコードが壊れない）。
- 旧固定枠（`attribute_*_1..5`、フラット単一SKU）は **新レコードで使わないが、読取は維持**（`resolveAttributes`/`productVariants` のフォールバックを残す）。
- 既存URL・APIパス・CSV列・エンコーディングを変えない（変えるならバージョン付き新設＋移行期間）。

## 8.11 禁止される実装パターン（明示）

- 新しいグローバル状態（ストア/モジュールスコープ可変/React外pub/sub）の安易な追加。
- `shared`・`utils` への「何でも移動」。
- 既存機能と重複する新機能（単品版/一括版のさらなる分岐、カテゴリ支援の4つ目の実装 等）。
- 無関係ファイルの同時変更・巨大PR。
- テストなしの大規模変更／テスト・設定の書き換えによる"合格"。
- コンポーネント/route からのモール外部API 直呼び、任意テーブル直クエリ。
- `ProductForm.tsx` をさらに肥大させる追記（新セクションは子コンポーネントへ分割）。

## 8.12 作業完了時の報告形式

- **変更点**（ファイル単位）／**検証手順と結果**（lint・型・vitest・該当E2E の実行ログ）／**互換性影響**（URL/API/保存データ/CSV に触れたか）／**ロールバック方法**（revert 単位）を必ず記載。
- 「何を確認し、何を確認していないか」を分ける（未確認は「要追加確認」と明示）。
- 短いチェックリスト＋次アクション（既存の Output style 準拠）。
