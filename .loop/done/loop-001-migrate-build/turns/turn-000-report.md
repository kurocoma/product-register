# turn-000 report (generator)

## 実行コマンドと結果（提出前4ゲート）
すべて `cd "C:/Users/hppym/dev/product-register/webui"` 配下で実行。

| ゲート | コマンド | 結果 |
|---|---|---|
| 型 | `npx tsc --noEmit` | exit 0 |
| lint | `npm run lint` | exit 0（warning 8件はすべて既存ファイル由来。新規ファイルに警告・エラーなし） |
| test | `npm run test` | exit 0 / **168 passed**（既存139 + 新規29） |
| build | `npm run build` | exit 0 |

ベースライン（実装前）の test も確認: 19 files / 139 passed。新規追加後は 23 files / 168 passed。

### 新規テスト内訳（29件）
- `manage-numbers.test.ts` … 10件
- `plan.test.ts` … 9件
- `defaults.test.ts` … 2件
- `result.test.ts` … 8件

## 追加ファイル一覧（plan の Changes に準拠・すべて新規。既存ファイルは一切変更なし）
すべて `webui/lib/migrate/` 配下。副作用なしの純TS（supabase/fetch/next を import しない）。

| ファイル | 何を / なぜ |
|---|---|
| `types.ts` | 契約型を1箇所に固定（`MigrationStep` / `ItemStatus` / `PlanAction` / `ManageNumberParseResult` / `ItemPlanInput` / `MigrationItemPlan` / `MigrationItemResult` / `MigrationSummary` / `SafeStateDefaults`）。API/UI/テストで per-item 契約を共有し AC-001 のレスポンス形をブレさせないため。 |
| `manage-numbers.ts` | `parseManageNumbers(input: string \| string[])`。改行/カンマ/CSV1列・配列を正規化、前後空白除去・空行無視・完全一致重複除去、楽天管理番号 `^[a-zA-Z0-9_-]{1,32}$`（既存 `lib/converters/mall-import.ts` の規約に整合）で valid/invalid 分類。AC-001。 |
| `plan.ts` | `buildItemPlan(input)` 純関数。カテゴリ未解決(null/false)・多SKU・高度設定・必須項目不足を全列挙し `action`(migrate/requires_manual) を決定。I/O は注入。AC-004/AC-008（誤カテゴリ・多SKU/高度設定の安全化）。 |
| `defaults.ts` | `safeStateDefaults(publish)`。false→`{yahooDisplay:0,stock:0,registerPublish:false}`（二重安全）/ true→`{yahooDisplay:1,stock:1,registerPublish:true}`。既存 `app/api/register/yahoo/[id]`（display:0 安全登録）の思想に整合。AC-002。 |
| `result.ts` | `aggregate(results)`（total/migrated(=ok)/requiresManual/skipped/failed 集計）と `runItems<T extends {manageNumber}>(items, perItem, {continueOnError=true, errorStep="register"})`（1件 throw でも継続し失敗を結果化・順序保持）。AC-003 の失敗継続を I/O 非依存で。 |
| `index.ts` | 上記の re-export（純ロジック層の公開窓口）。 |
| `manage-numbers.test.ts` / `plan.test.ts` / `defaults.test.ts` / `result.test.ts` | 各モジュールの vitest 単体テスト。AC-009。 |

## plan からの軽微な明確化（緩和ではなく具体化）
- `runItems` の型引数を `<T extends { manageNumber: string }>` に制約。throw 時に失敗結果へ `manageNumber` を載せるため（移行アイテムは必ず管理番号を持つ前提に整合）。
- `runItems` に任意 `errorStep`(既定 "register") を追加。想定外 throw 時の `MigrationItemResult.step` を決めるため。AC-003 の挙動には影響しない補助。
- `safeStateDefaults(true)` の `stock` は最小公開相当の `1`（実在庫は実フロー側で上書きする想定）。本セッションでは publish=false のみ使用。

## 未解決事項 / 既知リスク
- 本周回は **pure ロジック層のみ**。API route `/api/migrate/rakuten-to-yahoo`、UI パネル、既存取込/登録/画像/カテゴリ関数の抽出・再利用は後続周回（plan 記載どおり今回スコープ外）。AC-005/006/007 はルート実装周回で充足予定。
- `buildItemPlan` は I/O 結果の注入を前提とする純関数。実際のカテゴリ解決(`fetchYahooCategoryMapping` が null→未解決)・多SKU検出(`productVariants`)・Yahoo必須検証(`validateEditItemParams`)との配線は後続周回で行う。

## 触っていない範囲（plan外・意図的保留）
- 既存 routes / components / 既存 lib（converters/rakuten/yahoo/product 等）: 変更なし（追加のみ）。
- 設定・依存・ハーネス（`package.json`/lockfile, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `.claude/`, `.loop/`, `scripts/`）: 一切未変更。
- 既存テスト: 削除/スキップ/緩和なし（139件すべて緑のまま）。
