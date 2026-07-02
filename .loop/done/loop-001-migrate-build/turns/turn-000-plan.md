# turn-000 plan

## Goal
楽天→Yahoo 一括移行の **pure ロジック層**（副作用なし・I/O非依存）を `webui/lib/migrate/` に新規追加し、vitest 単体テストを付ける。**既存ファイルは一切変更しない**。これにより hard gate(lint/tsc/unit/build)を緑のまま、実装の核（入力正規化・per-item判定・安全既定・失敗継続集計）を導入する。API route / UI / 既存関数抽出は後続周回。

## Analysis
- 直前 eval: なし（初周）。hard gate 失敗: なし（ベースライン4ゲート緑を確認済み）。
- 根本: 単品「楽天→Yahoo」は実在するが、一括化に必要な「入力の正規化」「per-item の移行可否判定（カテゴリnull/多SKU/高度設定）」「安全既定」「失敗継続の集計」が未分離。これらを純関数として先に固め、テスト可能にする。
- 今回触る範囲: `webui/lib/migrate/`（新規ディレクトリのみ）。
- 今回触らない範囲: 既存の routes/components/lib、設定ファイル、依存、eval-loop ハーネス。
- 元依頼との関係: REQ-001（管理番号リスト→Yahoo安全移行）の中核ロジック。
- acceptance との関係: AC-001（入力受理）/AC-002（安全既定）/AC-003（失敗継続）/AC-004（カテゴリnull安全化）/AC-008（多SKU/高度設定スキップ）/AC-009（単体テスト）を pure 層で満たす。AC-005/006/007 はルート実装の後続周回（今回は無破壊で前提を満たす）。
- criteria との関係: correctness（仕様一致）/maintainability（pure と I/O 分離）/test_quality（意味あるテスト）/risk_control（誤登録防止判定）。
- 互換性リスク: 追加のみなので既存挙動・既存テストへの影響なし（regression_safety を最大化）。

## Changes
新規ファイル（すべて `webui/lib/migrate/` 配下。**外部I/O・supabase・fetch を import しない純TS**）:

- `types.ts`: 契約型を1箇所に固定。`MigrationStep`('import'|'category'|'register'|'image'|'submit'), `ItemStatus`('migrate'|'requires_manual'|'skipped'|'failed'|'ok'), `ManageNumberParseResult`, `MigrationItemPlan`(manageNumber, action, reasons[], 各種フラグ), `MigrationItemResult`(manageNumber, productId?, step, ok, status, error?), `MigrationSummary`, `SafeStateDefaults`。
  なぜ: API/UI/テストで per-item 契約を共有し、AC-001 のレスポンス形をブレさせない。
- `manage-numbers.ts`: `parseManageNumbers(input: string | string[]): ManageNumberParseResult`。改行/カンマ/CSV1列・前後空白・空行・重複を正規化し、楽天管理番号の文字種 `^[a-zA-Z0-9_-]{1,32}$`(既存 `lib/converters/mall-import.ts` の検証規約に整合) で valid/invalid 分類。`{valid[], invalid[{raw,reason}], duplicatesRemoved}`。
  なぜ: AC-001。既存の楽天管理番号制約に合わせて不正入力を早期に弾く。
- `plan.ts`: `buildItemPlan(input): MigrationItemPlan` 純関数。引数で `{ manageNumber, existed, yahooCategoryResolved(boolean|null), hasMultipleSku, hasAdvancedYahooSettings, missingRequiredYahooFields(string[]) }` を受け、`action` と `reasons[]` を決定: カテゴリ未解決→requires_manual / 多SKU・高度設定→requires_manual / それ以外→migrate。I/O はしない（取込・mapping解決・detect は呼び出し側で注入）。
  なぜ: AC-004/AC-008 の安全判定を副作用なしで網羅テストするため。
- `defaults.ts`: `safeStateDefaults(publish: boolean): SafeStateDefaults`。publish=false→{ yahooDisplay:0, stock:0, registerPublish:false }、true→公開相当。既存 `app/api/register/yahoo/[id]` の安全状態(display:0)思想に整合。
  なぜ: AC-002 を1箇所に固定。
- `result.ts`: `aggregate(results): MigrationSummary`（total/migrated/requiresManual/skipped/failed 集計）と `async runItems<T>(items, perItem, {continueOnError=true}): Promise<MigrationItemResult[]>`（1件が throw/reject でも残りを処理し失敗を結果化）。perItem は注入（純粋オーケストレータ）。
  なぜ: AC-003 の失敗継続と集計を I/O 非依存でテストするため。
- `index.ts`: re-export。

新規テスト（同位置 `*.test.ts`、vitest）:
- `manage-numbers.test.ts`: 改行/CSV/配列入力・重複除去・空行無視・不正文字種・32文字超過。
- `plan.test.ts`: category未解決→requires_manual / 多SKU→requires_manual / 高度設定→requires_manual / 正常→migrate / 複合理由。
- `defaults.test.ts`: publish false/true の既定値。
- `result.test.ts`: 集計の正しさ・1件 throw でも継続し summary.failed に計上（AC-003）・順序保持。

## Pre-submission checks（generator が提出前に実行）
- `cd webui && npx tsc --noEmit` → 0
- `cd webui && npm run lint` → 0
- `cd webui && npm run test` → 既存139 + 新規が全緑
- `cd webui && npm run build` → 0
（この欄は generator 用。evaluator の採点軸ではない）
