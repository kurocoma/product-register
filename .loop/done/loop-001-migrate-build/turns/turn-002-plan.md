# turn-002 plan

## Goal
turn-001 の独立 evaluator 指摘（score 83）を解消し、score≥90 を狙う。優先順:
①【最優先・実バグ】dry-run の `summary.migrated=0` を修正、②【必須デリバラブル】一覧の一括移行 **UIパネル**、③在庫0 の担保 or 明文化(AC-002 honest化)、④**route レベル統合テスト**(mock)、⑤レート制御、⑥デッドコード除去。
すべて target_paths 内（`webui/lib/migrate/`, `webui/app/api/migrate/`, `webui/components/product/`）。UI 設置のため `webui/app/(main)/products/page.tsx` に**最小1行のマウント追加**のみ行う（既存挙動不変・非禁止）。既存ファイルの破壊的変更・既存テストの編集/緩和は禁止。新規テストは Bash で作成（既存 `*.test.*` の Edit/Write はグローバル deny）。

## Analysis
- 直前 eval(turn-001) score 83。低下: correctness 74 / test_quality 80 / risk_control 84。hard gate 緑(unit180)。
- feedback.md の6項目を反映。各 AC の現状: AC-001/003/004/005/006/007/008/009 充足、AC-002 は display:0 のみで在庫0未適用（部分）。
- 実バグ: `result.ts aggregate()` は `status="migrate"` を加算しない。executor の dry-run は `status="migrate"` を返す（executor.ts:154）→ 既定 dry-run の `summary.migrated=0`（このセッションの主目的＝安全プレビューが壊れる）。
- 既存テスト保護: `result.test.ts`/`executor.test.ts` は **編集不可**（guard）。集計の挙動変更は「既存の戻り値 shape を壊さない（既存テスト緑のまま）」方針で行い、新規テストは別ファイルを Bash 作成。
- UI 設置先: `app/(main)/products/page.tsx`（`MallImportByCode`/`RelatedImportSearch`/`ProductList` を並べる構成。同階層に `MigratePanel` を追加）。スタイルは既存 `MallImportByCode.tsx`/`RelatedImportSearch.tsx` に合わせる。
- criteria 影響: correctness(主目的のdry-run正当化+UI成立)・test_quality(route統合テスト)・risk_control(在庫0/レート制御)・integration_fit(UIが一覧に統合) を引き上げ。regression_safety は既存無改変で維持。

## Changes
### ① dry-run summary 修正（correctness・最優先）
- `webui/lib/migrate/result.ts` `aggregate()`: `status==="migrate"` を集計に反映する。**既存の戻り値フィールド/型 shape を変えない**こと（既存 result.test.ts を壊さない）。推奨実装: `migrated` を「移行済み(commit: status=ok) ＋ 移行可(dry-run: status=migrate)」として両方を加算（1 run は dry-run か commit のいずれかなので意味は一意）。`MigrationSummary` に新フィールドを足す場合は **追加のみ**（既存キー不変）で、既存テストが toEqual 厳密一致なら採らない。実装前に `result.test.ts` の検証方法(toEqual/toMatchObject)を Read で確認し、壊れない方を選ぶ。
  なぜ: 既定 dry-run プレビューの集計が実態を反映する（安全プレビューの正当性）。
- 新規テスト `webui/lib/migrate/result-summary.test.ts`（Bash 作成）: dry-run 相当（status=migrate を複数）＋ requires_manual ＋ failed の混在を aggregate して、移行可件数が正しく数えられることを検証。

### ② UIパネル（必須デリバラブル・correctness/integration）
- `webui/components/product/MigratePanel.tsx`（新規, "use client"）: 楽天管理番号を改行/カンマ/CSV1列で貼付するテキストエリア →「移行プレビュー(dry-run)」ボタンで `POST /api/migrate/rakuten-to-yahoo {manageNumbers, dryRun:true}` → per-item プレビュー表（管理番号 / 区分(migrate|requires_manual|failed) / 理由 / 既存有無 / カテゴリ解決）＋ summary（移行可/要手動/失敗/重複除去/不正）→「実行(登録)」ボタンで `{dryRun:false}` → 結果表（管理番号 / productId / step / 成否 / エラー）。busy/エラー表示は既存パネルの作法に合わせる。公開はしない旨の注記。
- `webui/app/(main)/products/page.tsx`: `MigratePanel` を import し、`RelatedImportSearch` の下に `<MigratePanel />` を1行追加（最小変更・既存挙動不変）。
  なぜ: ユーザー確定の「一覧の一括移行パネル」。evaluator が必須デリバラブル欠落として減点した点を解消。

### ③ 在庫0 の honest 化（risk_control/AC-002）
- editItem に在庫数の列が無い（在庫は別 API）。実態に合わせて契約を正直にする: `safeStateDefaults` の **未使用 `stock` を実際に適用できないなら削除**し、`defaults.ts`/executor に「安全機構は display=0。在庫は editItem 非対象（別運用）」と明記。もし在庫0を送れる経路があるなら適用してテストする。
- 影響テスト: `defaults.ts` の戻り値を変える場合、既存 `defaults.test.ts`（編集不可）が壊れないか Read で確認。壊れるなら「stock を残しつつ未使用と明記」に留め、別の新規テストで display=0 単層安全を文書化検証。
  なぜ: 「在庫0」を満たせない実態を曖昧にせず、AC-002 を honest に（評価の risk_control/maintainability）。

### ④ route レベル統合テスト（test_quality）
- 新規 `webui/app/api/migrate/rakuten-to-yahoo/route.test.ts`（Bash 作成）: `vi.mock` で `@/lib/supabase/server`・`@/lib/rakuten/credentials`・`@/lib/rakuten/item-client`・`@/lib/converters/rakuten-item-parser`・`@/lib/converters/mall-import`・`@/lib/product/category-mapping`・`@/lib/product/repository`・`@/lib/yahoo/auth`・`@/lib/yahoo/item-mapper`・`@/lib/yahoo/item-client`・`@/lib/history/recorder`・画像系 をモック。検証: (a) **dry-run では `getYahooAccessToken` を呼ばない**、(b) SKU検索フォールバック（getItem 不在→searchManageNumberBySku→再getItem）、(c) AC-001 レスポンス形（results 各要素 + summary + invalid + duplicatesRemoved）、(d) 未ログイン401。
  なぜ: route の依存配線・dry-run 非書込・SKUフォールバックが現状 untested（evaluator 指摘）。

### ⑤ レート制御（risk_control・task要件）
- item 間のレート制御を追加。実装は**テスト容易・既存非破壊**で: `result.ts runItems` に任意 `delayMs`/`concurrency`(既定は既存挙動＝順次・遅延0) を追加するか、route 側 perItem ラッパで `sleep` を挟む（sleep は注入可能にしテストは0）。既定値で既存 result.test.ts を壊さないこと。
  なぜ: 大量 commit 時のモールAPI過負荷防止（task のレート制御要件・risk_control）。

### ⑥ デッドコード除去（maintainability）
- 未使用 `MigrationStep "submit"`（types.ts）と、③で適用しないと決めた未使用フィールドを除去（参照が無いことを grep で確認してから）。型契約を実態に一致させる。

## Pre-submission checks（generator が提出前に実行）
- `cd webui && npx tsc --noEmit` → 0
- `cd webui && npm run lint` → 0（新規ファイルに警告/エラーを出さない）
- `cd webui && npm run test` → 既存180 + 新規が全緑（既存テストの削除/緩和なし）
- `cd webui && npm run build` → 0（`/api/migrate/rakuten-to-yahoo` と products ページが壊れない）
（この欄は generator 用。evaluator の採点軸ではない）

## 優先と budget 指針（generator 向け）
①→②→④→③→⑤→⑥ の順。ターンが尽きそうなら最低でも ①②④ を完了し4ゲート緑を確保、未完(⑤⑥等)は report と最終要約に正直に記す。既存テストは編集・緩和しない（実装を直す）。
