# アーキテクチャ監査（product-register）

> 作成日: 2026-07-18 ／ 対象コミット: `aeccdcd`（master）
> 本監査は **分析・設計ドキュメントのみ**。アプリのコード（`webui/` 配下・既存 `docs/` のアプリ資料）は一切変更していない。
> 事実には根拠ファイルパスを付け、確認できないものは「推測」「不明」「要追加確認」と明示している。
> 付随変更は `.gitignore` のみ（監査成果物 `docs/architecture-audit/` を追跡対象にする例外行。コード外・可逆）。

## 実施状況（2026-07-18 更新）

監査完了後、移行計画 05 の **M0〜M6 を実施済み**（いずれも tsc / eslint / vitest 998 / next build 緑を確認してコミット）:

| 段階 | コミット | 内容 |
|---|---|---|
| M0 | `d477062` | 未コミット機能一式（rule-audit / codex-normalize / research-import / 税率 / proxy 改称）を確定 |
| M1 | `fa51354` | サイドナビを目的別6グループへ再編、「商品編集」→「新規作成」 |
| M2 | `7222cf7` | ヘルプに「ルール監査」「画像一括アップロード」を追加しナビと整合 |
| M3 | `a5c525f` | 葉モジュール7つ（rakuten/shopify/ne-master/image/history/template/autosave）に barrel |
| M4 | `497115c` | `lib/shared/`（schema・utils の薄い re-export）新設 |
| M5 | `c55c2b7` `cb39c9f` | feature 6フォルダに barrel ＋ API ルート 152 import を barrel 経由へ |
| M6 | `50d8d32` | MigratePanel の mall 直参照解消（ui→mall 直import ゼロ） |
| ステップ8 | `4232948` | `webui/AGENTS.md`（恒久ルール）＋ `webui/CLAUDE.md`（ポインタ）を実ファイル化 |

**未着手**: M7（カテゴリ統合）/ M8（反映・画像・CSV 正本化）/ M9（命名・mall 集約）/ M10（ProductForm 分割）/ M11（masters タブ統合）/ M12（fetch・import 整理）/ M13（Python CLI 隔離）。M12・M13 は下記「要追加確認」の回答が前提。
**components/hooks の barrel 差替も未着手**（クライアントバンドル境界の検討後に段階実施。`webui/AGENTS.md` の import ルール参照）。

## 要追加確認（集約 — ユーザーへの質問リスト）

各ドキュメントに散在する「要追加確認」を1箇所に集約する。回答が移行の前提になるもの:

1. **旧 Python CLI（`src/product_register/`）は今も使っているか？**（定常バッチ・手動運用の有無）→ M13（隔離/削除)の前提
2. **`proxy.ts` の未ログインリダイレクトを実機確認してよいか**（E2E 実行には dev サーバ＋Supabase 環境が必要）→ M0 完了条件の残り
3. **`api/fetch`（既存商品への取込）と `api/import`（新規作成取込）の挙動差は意図どおりか** → M12（共通パーサ化）の前提
4. **`codex-normalize` / `research-import` の運用位置づけ**（常用機能か実験機能か）→ ナビ・ヘルプでの扱いに影響
5. **`/settings`（空実装）をナビに残すか、「準備中」表示にするか、非表示にするか**
6. **`.loop/archive-*` / `.agents/` / `.claude/settings.json` / `.codex/` を git 管理するか**（現在 untracked のまま保留）

## この監査の読み方

| # | ドキュメント | 対応する最終出力 |
|---|---|---|
| — | `README.md`（本書） | 1. 現状の問題点 / 全体索引 |
| 01 | `01-current-state.md` | （ステップ1）技術スタック・ルート・API・状態・保存・外部連携・テスト |
| 02 | `02-feature-ledger.md` | 2. 機能台帳 / 3. 統合候補 / 4. 廃止候補（＋機能分類・重複実装・不要コード） |
| 03 | `03-ux-navigation.md` | 5. 新しいナビゲーション案 |
| 04 | `04-target-architecture.md` | 6. 目標ディレクトリ構成 / 7. 依存関係ルール |
| 05 | `05-migration-plan.md` | 8. 段階的な移行順序 / 9. 各段階の完了条件 / 10. リスクとロールバック方法 |
| 06 | `06-test-plan.md` | 11. 必要な回帰テスト |
| 07 | `07-ai-rules.md` | 12. AI向けプロジェクトルール案 |

## 対象の全体像（確認済み）

- 実体は `webui/` の **Next.js 16 (App Router) + React 19 + TypeScript** アプリ。データは **Supabase (Auth + Postgres + RLS)**。根拠: `webui/package.json`、`webui/app/(main)/help/page.tsx`（技術仕様節）、`webui/supabase/migrations/`。
- マルチモール商品登録ツール。対象モール = **楽天 RMS / Yahoo!ショッピング / Shopify / ネクストエンジン(NE)**。根拠: `webui/lib/converters/`、`webui/lib/rakuten|yahoo|shopify/`、`docs/spec.md`。
- 規模（実測、テスト除く）: 画面ルート **18**（`app/**/page.tsx`）、API **25**（`app/**/route.ts`）、コンポーネント **37**（`components/**/*.tsx`）、lib モジュール **86**（`lib/**/*.ts`）、非テスト行数 **約22,424行**。テストは vitest **121ファイル** ＋ `webui/tests/` の E2E/verify スクリプト約30本。根拠: `find` 実測。
- リポジトリ直下には **旧 Python CLI（`src/product_register/`、Phase 1）** が併存。最終更新 2026-05-17。根拠: `pyproject.toml`、`git log -- src/`。詳細は 02 の「廃止候補」。

---

## 1. 現状の問題点（総括）

依頼で挙げられた8つの症状を、リポジトリ内の具体的根拠に紐づけて整理する。各項目の詳細対処は該当ドキュメントを参照。

### P1. 機能が増えすぎ・メニューが分かりにくい（→ 03）
- サイドナビが **15項目フラット**（`components/nav/SideNav.tsx`）。トップレベルに低頻度機能（マスタ取込・関連商品抽出・テンプレート管理・ルール監査）まで並列で並ぶ。
- ヘルプの画面目次は **12画面**（`app/(main)/help/page.tsx` の `SCREEN_TOC`）だが、ナビには **ルール監査 / 画像一括アップロード** が加わり **不一致**。新機能がヘルプに追随できていない（発見性の破綻）。
- 「商品編集」ナビが指すのは `/products/new`（新規作成）。ラベルと遷移先の意味がずれている。根拠: `SideNav.tsx` 10行目 → `app/(main)/products/new/page.tsx`。

### P2. 似た機能が複数存在する（→ 02, 03）
- **単品版と一括版の二重化**が各所にある: 画像アップロード（編集画面 `ImageUploadPanel` ↔ 専用ページ `/bulk-images`）、モール登録（`RegisterPanel` ↔ `/bulk-register`）、CSV（`CsvDownloadPanel` ↔ `/csv`）、モール取込編集（`MallEditPanel`/`MallImportByCode` ↔ `/migrate`）。
- **カテゴリ支援ロジックが複数ファイルに分散**: `lib/product/category-assist.ts` / `category-autofill.ts` / `category-mapping.ts`（重複実態は 02 の重複表で判定）。
- **ルール監査 `/rule-audit` と 編集内 codex-normalize**（`MallEditPanel`→`CodexProposalDiff`）が近縁。片方は検出、片方は修正。統合余地あり（02）。

### P3. コードの責務が混ざっている（→ 04, 05）
- `components/product/ProductForm.tsx` が **1223行** の巨大コンポーネント。10アコーディオン（基本/SKU/配送/説明/Yahoo/バリエーション/定期購入/画像/白背景/属性）に加え、Supabase 直呼び（`createClient`）・カテゴリマッピング取得・属性自動補完・ドラッグ並替を1ファイルに同居。UI に業務ロジックが集中している。根拠: `ProductForm.tsx`。
- 同ファイル冒頭にモジュールレベルの `whiteBgUploadListeners`（Set ベースの ad-hoc pub/sub）。React 外の暗黙グローバル状態。根拠: `ProductForm.tsx` 上部。

### P4. 変更時の影響範囲が分からない（→ 04, 06）
- モール横断のフィールドが1つの巨大 Zod スキーマ `lib/product/schema.ts`（338行、楽天/Yahoo/Shopify/定期購入/画像20枚/属性が渾然一体）に集約。1フィールド追加が全モール変換・全プレビュー・CSV・API に波及しうる。
- `extra` JSONB に「主要25列以外を全部入れる」設計（`lib/product/repository.ts`）。スキーマ変更の影響がDBに現れにくく、静的追跡が効きにくい。

### P5. shared / utils / グローバル状態の肥大化（→ 04）
- `lib/utils.ts` 自体は `cn()` のみで健全（肥大化なし）。**むしろ問題は逆**で、共通境界が未定義のまま各 `lib/<機能>/` が相互 import しうる状態。「置いてよい場所」のルールが無い（07 で規定）。
- グローバル状態ライブラリ（redux/zustand 等）は**不採用**（確認済み・後述 01）。状態は画面ローカル＋react-hook-form＋自動保存ステートマシンに閉じており、この点は良好。ただし P3 の ad-hoc pub/sub のような抜け道がある。

### P6. 古い実装と新しい実装が混在（→ 02, 05）
- **Python CLI（`src/product_register/`）と webui（`webui/lib/converters/`）が同じ変換ロジックを二重実装**。Phase 1（CSV CLI）→ Phase 2（WebUI+API）の移行途上で旧実装が残存。根拠: `src/product_register/converters/{rakuten,yahoo,ne,shopify}.py` ↔ `webui/lib/converters/{rakuten,yahoo,ne,shopify}.ts`、`docs/spec.md` §2。
- webui 内でも **旧固定枠と新可変版の後方互換が同居**: 属性 `attribute_item_1..5`（旧）↔ `attributes[]`（新）、単一SKUフラット項目（旧）↔ `variants[]`（新）。`schema.ts` の各ヘルパ（`resolveAttributes`/`productVariants`）が両対応。意図的な後方互換だが、新規実装がどちらに書くべきか迷う原因。

### P7. AIが新機能をどこに追加すべきか判断できない（→ 04, 07）
- `lib/` は機能ごとにフォルダ分割済みだが、**公開インターフェース（index/barrel）や依存ルールが未定義**。どのファイルが「入口」でどれが「内部」か不明。
- 命名パターンがモール間で不揃い（`*-api.ts` / `*-patch.ts` / `*-item-parser.ts` / `*-register-service.ts` / `item-client.ts` / `item-mapper.ts` が混在）。同じ役割に別名がつく。07 で恒久ルール化する。

### P8. リポジトリ衛生（付随・アプリ外）
- ルート直下・`docs/` に巨大バイナリ（`ichiba_attribute_list_20260421.csv` 約64MB、`rakuten_yahoo_category_mapping.csv` 約3.9MB、UIモック PNG、各種 zip）や、ハーネス生成物（`eval-loop-report.html` 等・`outputs/`・`.loop/`・`.mso/`）が散在。アプリの構造問題ではないが、探索コストと誤認を招く。**本監査の対象外**として記録に留める。

> 補足: `webui/middleware.ts` が削除され `webui/proxy.ts` が追加されている（git 上は `D middleware.ts` ＋ 未追跡 `proxy.ts`）。これは **Next.js 16 のミドルウェア→proxy 改称**への追随であり、認証の削除ではない（`proxy.ts` は `lib/supabase/middleware.ts` の `updateSession` を呼び未ログインを `/login` へ誘導）。詳細は 01。
