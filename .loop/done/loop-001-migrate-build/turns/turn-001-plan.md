# turn-001 plan

## Goal
turn-000 で投入した pure ロジック層（`webui/lib/migrate/`）を**実I/Oに配線**し、機能を成立させる。具体的には
(1) per-item オーケストレータ `executor.ts`（**依存注入**で単体テスト可能）を新規追加し、
(2) API route `POST /api/migrate/rakuten-to-yahoo`（**dry-run 既定 / commit 分岐**）を新規追加し、
(3) executor の**統合テスト（モックI/O）**を追加する。
これで AC-001/AC-005/AC-007 を充足し、AC-002/003/004/006/008 を実配線で裏づける。**UIパネルは turn-002 に後置**（AC は API/ロジック基準のため）。既存ファイルは原則変更しない（後方互換 AC-006）。

## Analysis
- 直前 eval(turn-000): score 82。低下要因は correctness 62 / integration_fit 72。原因は「pure 層は良いが呼ばれていない＝機能未成立」。hard gate は緑。
- feedback.md の次周方針＝「API route + per-item I/O 統合 + 統合テストを1スライス。executor は依存注入。既存ルート不変」。
- 実在する再利用部品（接地済み・import 経路は実コードで確認）:
  - 取込: `@/lib/rakuten/credentials` `getRakutenCredentialsFromEnv`、`@/lib/rakuten/item-client` `getItem`(as getRakutenItem)/`searchManageNumberBySku`、`@/lib/converters/rakuten-item-parser` `parseRakutenItem`/`parseRakutenVariants`、`@/lib/converters/mall-import` `buildImportedProduct`(→`{ok,product,neCode,error}`)、`@/lib/product/repository` `upsertProduct`/`getProduct`/`dbRowToProductInput`。
  - Yahoo登録: `@/lib/yahoo/auth` `getYahooConfig`/`getYahooAccessToken`、`@/lib/yahoo/item-mapper` `buildYahooEditItemParams`/`validateEditItemParams`、`@/lib/yahoo/item-client` `editItem`/`getItem`/`submitItem`。安全既定は `forceDisplay="0"`（既存 register/yahoo POST と一致）。
  - カテゴリ: `@/lib/product/category-mapping` `fetchYahooCategoryMapping`（楽天ジャンル→Yahoo、null=未解決→requires_manual）。
  - 多SKU検出: `parseRakutenVariants(json)` の要素数 > 1 で多SKU → requires_manual（AC-008）。
  - 重複排除: 既存 import route のロジック（products を `extra->>rakuten_manage_number` 優先→`ne_code` で照合）。**既存ルートを変更しないため**、同等の照合を migrate 側のヘルパとして実装（または既存挙動を壊さない範囲で `lib/product` に共有関数を新設して両者利用）。
- acceptance との関係: AC-001(route 入力受理＋per-item結果/summary)・AC-005(dry-run 非書込)・AC-007(ne_code 重複排除)を新規充足。AC-002(安全既定 forceDisplay=0)・AC-003(fail-continue, 既存 runItems 活用)・AC-004(category=null skip)・AC-008(多SKU skip) を実配線で裏づけ。AC-006 は既存ファイル無改変＋既存テスト緑で担保。AC-009 は executor の単体/統合テストで拡充。
- criteria との関係: correctness(機能成立)・integration_fit(既存 csv/bulk 規約・supabase認証・recordHistory・converter 再利用に整合)を主に引き上げ。risk_control(安全既定/誤登録防止)・test_quality(モックI/Oで意味ある統合テスト) を維持。
- 互換性リスク: route/executor は**新規追加**。既存ルート(import/register/fetch/update/upload)と既存テストは不変。共有関数を新設する場合も既存呼び出し側の外部挙動を変えない（シグネチャ追加のみ・既定値で後方互換）。
- 設計方針: route は薄く（認証・入力parse・依存組立・`runItems` 呼び出し・整形のみ）。判断と副作用順序は executor に集約し、**全依存を引数注入**して vitest で live API 無しに検証する。

## Changes
新規ファイル（**既存ファイルは変更しない**。やむを得ず共有関数を新設する場合のみ `webui/lib/product/` に後方互換で追加）:

- `webui/lib/migrate/executor.ts`（新規）: `makePerItemExecutor(deps): (manageNumber) => Promise<MigrationItemResult>` を返すファクトリ。`deps` は注入インターフェース（`resolveRakutenItem`, `parseItem`, `parseVariants`, `buildImported`, `findExisting`, `upsert`, `resolveCategory`, `buildYahooParams`, `validateYahoo`, `editYahoo`, `syncImage`, `recordHistory` 等）。処理順:
  1. 楽天取込解決（getRakutenItem→無ければ searchManageNumberBySku フォールバック。見つからねば status=failed, step=import）。
  2. `parseRakutenItem` + `parseRakutenVariants`。多SKU(variants>1)・高度設定を検出。
  3. `buildImportedProduct`（`ok=false`→status=failed, step=import, error=built.error）。
  4. カテゴリ解決 `fetchYahooCategoryMapping`（null→未解決フラグ）。
  5. `buildItemPlan({ existed, yahooCategoryResolved, hasMultipleSku, hasAdvancedYahooSettings, missingRequiredYahooFields })`（turn-000 の純関数）で action 決定。requires_manual/skip はここで return（**登録しない**）。
  6. **dry-run**: ここまでの plan を `MigrationItemResult`(ok=true, status=plan結果, step 未到達) として返し、**upsert/editItem/画像/履歴を一切呼ばない**（AC-005）。
  7. **commit**: `findExisting`（manage→ne_code）で既存照合（existed なら upsert せず既存 productId 採用＝AC-007）→ 必要時 `upsertProduct` → `buildYahooEditItemParams(product,{sellerId, forUpdate, forceDisplay:"0"})`（安全既定 AC-002）→ `validateEditItemParams`（不足→status=failed, step=register, error=missing）→ `editItem`（失敗→status=failed）→ 画像同期（yahoo-sync 相当）→ `recordHistory` → status=ok, step=submit未満（公開はしない）。
  なぜ: 判断と副作用順序を1箇所に集約し、依存注入で AC-002/004/005/007/008 を live API 無しに網羅テストするため。
- `webui/app/api/migrate/rakuten-to-yahoo/route.ts`（新規）: `export const runtime="nodejs"`。`POST` のみ。
  - supabase 認証（`createClient`→`auth.getUser`、未ログイン 401）。既存 csv/bulk・import の認証規約に一致。
  - body: `{ manageNumbers: string | string[], dryRun?: boolean(既定 true), publish?: boolean(既定 false), continueOnError?: boolean(既定 true) }`。`parseManageNumbers` で正規化（valid/invalid/重複除去）。
  - 実依存を組み立てて `makePerItemExecutor` に渡し、`runItems(valid, executor, {continueOnError})` → `aggregate` → `NextResponse.json({ ok:true, dryRun, results, summary, invalid })`。
  - publish=true は本セッションでは使わない（安全側）。公開(submitItem)は呼ばない。
  なぜ: AC-001（入力受理＋per-item結果/summary）と AC-005（dry-run 非書込）を route 層で確定。
- `webui/lib/migrate/executor.test.ts`（新規, vitest）: 注入 fake で—
  - dry-run: upsert/editItem/画像/履歴の fake が**呼ばれない**こと（AC-005）。
  - commit 正常: 呼び出し順（buildImported→findExisting→upsert→buildYahooParams(forceDisplay="0")→validate→editItem→image→history）と status=ok。
  - category=null → requires_manual、登録系 fake が呼ばれない（AC-004）。
  - 多SKU(variants>1) → requires_manual、登録系未呼び出し（AC-008）。
  - existed=true → upsert 未呼び出しで既存 productId 採用（AC-007）。
  - 安全既定: commit 時 forceDisplay="0"（AC-002）。
  - fail-continue: 1件の executor が throw でも `runItems` で残りが処理され `summary.failed` に計上・順序保持（AC-003）。
  - 必須不足: validateYahoo→missing で status=failed, step=register。
- （任意・小）`webui/app/api/migrate/rakuten-to-yahoo/route.test.ts`: 依存モジュールを `vi.mock` し、POST のレスポンス形（results 各要素が {manageNumber, productId?, step, ok, status, error?}、summary 集計）が AC-001 契約に一致することを1〜2ケース検証。route が重ければ executor テストを主とし本テストは最小限。

## Pre-submission checks（generator が提出前に実行）
- `cd webui && npx tsc --noEmit` → 0
- `cd webui && npm run lint` → 0（新規ファイルに警告・エラーを出さない）
- `cd webui && npm run test` → 既存168 + 新規が全緑（既存テストの削除/緩和なし）
- `cd webui && npm run build` → 0
（この欄は generator 用。evaluator の採点軸ではない）
