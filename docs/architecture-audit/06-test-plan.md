# 06. テスト計画（ステップ7 ／ 最終出力11）

目的: リファクタ（画面統合・コード移動）で **ユーザーから見た振る舞い** と **保存/URL/CSV/API 互換** を壊さないための回帰網。実装詳細に過度依存せず、外部観測可能な結果を軸にする。

前提（確認済み）:
- 既存 vitest 121ファイル・`webui/tests/` の E2E/verify 群がある（01 §1.9）。
- **テスト/spec ファイルの既存改変は禁止**（deny＋guard）。**新規テスト作成は可**。→ 回帰網は「既存を壊さず新規追加」で組む。
- 移行は機能単位（05）。各ステップの完了条件に対応する回帰テストを紐づける。

## 7.1 最重要ユーザーフロー（優先順）

`app/(main)/help/page.tsx` の手順と E2E 実在ファイルから逆算した、壊すと業務が止まるフロー。

| 優先 | フロー | 開始→完了 | 既存の関連E2E（`tests/`） |
|---|---|---|---|
| P0 | 新規商品を作成し自動保存される | `/products/new` 入力→自動保存→`/products/[id]` へ遷移 | `e2e_flow.mjs`, `e2e_save_validation.mjs` |
| P0 | 楽天へ登録（dry-run→commit） | 編集→`RegisterPanel`→`api/register/rakuten/[id]` | `e2e_register_rakuten.mjs` |
| P0 | Yahooへ登録（画像lib先行） | 画像同期→`api/register/yahoo/[id]` | `e2e_register_yahoo*.mjs`, `e2e_yahoo_image_sync.mjs` |
| P0 | 商品一覧で価格インライン編集→自動保存→反映 | `/products`→`api/products/[id]/price` | `e2e_update_rakuten.mjs`, `e2e_update_yahoo.mjs` |
| P1 | 楽天→Yahoo 一括移行 | `/migrate`→`api/migrate/rakuten-to-yahoo` | `e2e_migrate.mjs` |
| P1 | 一括登録（グリッド→dry-run→commit） | `/bulk-register`→`api/register/bulk/[mall]` | `e2e_bulk_register.mjs`, `e2e_bulk_*.ts` |
| P1 | CSV 5形式ZIPダウンロード | `/csv`→`api/csv/bulk` | `e2e_saledesc.mjs`(部分), verify系 |
| P1 | モール現物の取込→編集→反映（往復） | `/products` MallImport / `api/fetch`・`api/update` | `e2e_import_rakuten.mjs`, `e2e_update_*_extkey.mjs`, `e2e_update_shopify.mjs` |
| P2 | 多SKU（単品＋セット）取込・登録 | `/related-import`, variants[] | `e2e_multisku_rakuten.mjs`, `e2e_neset.mjs` |
| P2 | マスタ取込→関連商品抽出 | `/masters`→`/masters/related` | `e2e_ne_master_import.mjs`, `e2e_ne_master_related.mjs` |
| P2 | 画像一括アップロード | `/bulk-images`→`api/upload/bulk-image` | `e2e_upload_route.mjs`, `e2e_yahoo_upload_route.mjs` |

## 7.2 テストマトリクス

| 機能 | 正常系 | 異常系 | 境界値 | データ互換性 | 優先度 |
|---|---|---|---|---|---|
| 商品保存(upsert) | 新規作成・更新が反映 | NEコード未入力/重複(23505)で明示エラー | NEコード空/超長、税率8・10のみ | 主要25列⇔`extra` JSONB 往復（`repository.test.ts`）、旧属性1..5⇔`attributes[]` | P0 |
| 楽天変換/登録 | 親子・SKU・税率0.1変換 | 必須属性欠落で日本語エラー | 画像0/20枚、462列ON/OFF | 取込→編集→反映で管理番号往復（`rakuten_manage_number`） | P0 |
| Yahoo変換/登録 | editItem 反映・grouping | it-14091（画像未転送）を検出 | 商品名/文字数上限、税抜→税込 | grouping/variation ラウンドトリップ（`yahoo-advanced-roundtrip.test.ts`） | P0 |
| Shopify変換/更新 | GraphQL 部分更新 | 未連携(product_id空)時の分岐 | status/SEO の未設定=現状維持 | `shopify_overrides` の extra 往復 | P1 |
| NE CSV | 単品/セット2ファイル | 代表商品コード欠落 | 94/92列、utf-8(BOM無) | 既存63商品の出力照合（Phase1受入） | P1 |
| 価格インライン編集 | 0.7秒デバウンス保存 | 保存失敗→リトライ | 0円・二重価格(display_price) | 定期価格0円解除の未反映表示 | P0 |
| 自動保存 | 0.8秒デバウンス・保存済表示 | 失敗バナー＋手動再試行・離脱ガード | 連打・オフライン | 状態機械 `autosave/machine.test.ts` | P0 |
| カテゴリ自動補完 | カテゴリID→Yahooカテゴリ＋必須属性 | 対応表ヒット無し（手入力誘導） | 空カテゴリ、複数候補 | `rakuten_yahoo_category_mapping` 参照 | P1 |
| 一括移行 | 対応表で自動変換 | 未対応=手入力ブロック | 大量件（チャンク/再開） | 配送/納期マッピング適用・`yahoo_rewrite` 恒久化 | P1 |
| CSV ZIP | 5形式同梱・cp932/utf-8 | 空選択・巨大選択 | 1件/全件 | 各モール列数（108/85/94/92/60） | P1 |
| 画像アップロード | R-Cabinet/Yahoo/Shopify 転送 | QPS制限→間隔＋リトライ | 大サイズ・同名衝突 | 取込画像→公開URL→反映時 location 変換 | P1 |
| 認証/RLS | 未ログイン→/login | 他ユーザーデータ不可視 | セッション期限 | RLS `auth.uid()=user_id` | P0 |

## 7.3 自動テストの役割分担

- **ユニット（vitest）**: 変換・パッチ・パーサ・スキーマ・状態機械の純ロジック。移行で **ファイルを移動しても import 経路だけ変わり振る舞い不変** を担保する土台。既存の `lib/converters/*.test.ts`・`lib/product/*.test.ts` を温存。
- **結合（vitest ＋ route ハンドラ）**: API route の入出力契約（`api/csv/bulk`、`api/register/*`、`api/update/*`）。モール外部呼び出しはモック/ドライラン境界で検証。
- **E2E（Playwright, `tests/`）**: 画面遷移・自動保存・dry-run→commit・失敗分再実行など UI 込みフロー。**画面統合（03）を行う各ステップの受入判定に使う**。

## 7.4 手動確認（自動化しにくい領域）

- 実モール API への本番反映（楽天RMS/Yahoo/Shopify の実データ登録）。→ dry-run で最大限自動化し、本反映は手動チェックリスト。
- Codex CLI 連携（`rule-audit`/`research-import`）の提案品質。→ 生成物の妥当性は人手レビュー。
- R-Cabinet/Yahoo lib の画像見た目・順序。
- cp932 の文字化け目視（機種依存文字）。

## 7.5 互換性確認チェックリスト（リファクタ前後で必ず一致）

| 対象 | 確認方法 | 根拠 |
|---|---|---|
| 既存URL | `/products/[id]`・`/migrate`・`/csv` 等 18ルートが同一パスで応答 | `app/**/page.tsx` |
| 既存API | 25 route の URL・メソッド・レスポンス形が不変（特に `research-import` の外部呼び出し契約） | `app/api/**/route.ts` |
| 保存済みデータ | `products.extra` JSONB の読み書きラウンドトリップ（旧レコードで再現） | `repository.test.ts` |
| 設定 | `settings`/`maker_codes`/`product_templates` の読み書き | migrations |
| エクスポート形式 | 各モールCSVの列数・エンコーディング（108/85/94/92/60、cp932/utf-8） | `help/page.tsx` 技術仕様、`lib/csv/` |
| 認証・権限 | 未ログインリダイレクト・RLS | `proxy.ts`, `layout.tsx`, RLS policies |
| 外部連携 | 楽天/Yahoo/Shopify の登録・更新・画像・在庫が従来通り | `lib/rakuten|yahoo|shopify/` |

## 7.6 今回対象に「最低限」必要な新規テスト（コスト×リスクで優先）

分析段階では新規テストは書かない（コード不変）。移行実施フェーズ（05）で各ステップに付す最小セット:

1. **移動前スナップショット**: 移すモジュールの公開関数について、入出力を固定する characterization test を **移動前に新規作成**（既存を触らず）。移動後に同テストが通れば振る舞い不変を証明。優先: 変換/パッチ系（P0）。
2. **API 契約テスト**: 統合対象の route（例: CSV 単品/一括、画像 単品/一括）に、リクエスト→ステータス/本文の契約テストを追加。優先: 統合を予定する route（P1）。
3. **`extra` JSONB 往復テスト**: スキーマ分割（04）に着手する前に、代表レコードで往復不変を固定。優先 P0。
4. **ナビ/ルート存在テスト**: 18ルートが 200/リダイレクトを返す薄い E2E。画面統合時のリンク切れ検出。優先 P1。

> 詳細な機能別の受入条件は `05-migration-plan.md` の各ステップ「完了条件」に対応づける。
