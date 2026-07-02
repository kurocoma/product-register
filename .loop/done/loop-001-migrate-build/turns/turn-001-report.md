# turn-001 generator report

## 実行したコマンドと結果（webui/ 配下・4ゲート）
- `npx tsc --noEmit` → pass（exit 0）
- `npm run lint` → pass（exit 0。warning 8件はすべて既存ファイル: YahooPreview/ProductForm/repository.test/e2e。**新規3ファイルは警告0**）
- `npm run test` → pass（exit 0。**Test Files 24 passed / Tests 180 passed** = 既存168＋新規executorテスト12）
- `npm run build` → pass（exit 0。ルート `ƒ /api/migrate/rakuten-to-yahoo` が登録されたことを出力で確認）
- 参考: `npx vitest run lib/migrate/executor.test.ts` 単体 → 12 passed

## 変更ファイル（新規のみ。既存ファイルは無改変＝後方互換 AC-006）
- `webui/lib/migrate/executor.ts`（新規）: per-item オーケストレータ `makePerItemExecutor(deps, opts)`。
  全副作用を依存注入(`ExecutorDeps`)で受け取り、判断と副作用順序を1箇所に集約。処理順=
  resolveRakutenItem(get→SKU検索フォールバック)→parseItem/parseVariants(多SKU検出)→buildImported→
  resolveCategory(null=未解決)→findExisting(管理番号→ne_code)→buildYahooParams+validateYahoo(必須不足検出)→
  buildItemPlan。**dry-run は書込系(upsert/editItem/画像/履歴)を一切呼ばず status="migrate" を返す(AC-005)**。
  commit は existed なら upsert せず既存ID採用(AC-007)→buildYahooParams(forceDisplay="0" 安全既定 AC-002)→
  validate→editItem→画像同期(ベストエフォート)→recordHistory→status="ok"。
  category=null / 多SKU(variants>1) / 高度設定(yahoo_grouping_enabled) / 必須不足は requires_manual で**登録しない**(AC-004/008)。
  なぜ: live API 無しで安全既定・dry-run 非書込・スキップ判定・重複排除・失敗継続を網羅検証可能にするため。
- `webui/app/api/migrate/rakuten-to-yahoo/route.ts`（新規）: `runtime="nodejs"`、POST のみ。
  supabase 認証(未ログイン401)→body `{manageNumbers, dryRun=true, publish=false, continueOnError=true}`→
  `parseManageNumbers` で正規化→実依存を組み立て `makePerItemExecutor`→`runItems`→`aggregate`→
  `{ok,dryRun,publish,results,summary,invalid,duplicatesRemoved}` を返す。
  `findExistingProduct`(extra->>rakuten_manage_number 優先→ne_code、limit(1)) を import route と同等に migrate 側へ実装。
  画像同期 `syncYahooImages` は upload/yahoo-sync と同じ lib(buildYahooLibFileName/processForCabinet/uploadLibImage)で薄く配線。
  公開(submitItem)は呼ばない。なぜ: AC-001(入力受理＋per-item結果/summary)・AC-005(dry-run分岐) を route 層で確定。
- `webui/lib/migrate/executor.test.ts`（新規, vitest 12ケース。Bash cp で配置=新規テスト作成。既存テストは未改変）:
  dry-run 非書込(AC-005)/commit 副作用順序＋status=ok/forceDisplay="0"(AC-002)/publish=true は forceDisplay 無し/
  category=null→requires_manual＋登録系未呼出(AC-004)/多SKU→requires_manual(AC-008)/高度設定→requires_manual/
  existed=true→upsert未呼出で既存ID(AC-007)/楽天無し→failed,step=import/必須不足→登録せず editItem未呼出/
  editItem失敗→failed,step=register/runItems失敗継続→summary.failed計上・順序保持(AC-003)。

## 設計上の注記 / 既知リスク
- dry-run の per-item は status="migrate"（turn-000 の plan ステータス）で返す。`aggregate` は "migrate" を
  各カテゴリに加算しない仕様のため、**dry-run の summary は migrated=0** となり total=各カテゴリ合計にならない。
  これは plan(Changes 6: "status=plan結果")に忠実な挙動。`results[]` には per-item の action が反映されるので
  プレビュー情報は失われない。集計の見せ方を変える場合は UI/route 側で migrate 件数を別途数える（turn-002 候補）。
- 必須項目不足(validateYahoo→missing)は buildItemPlan の missingRequiredYahooFields 経由で **requires_manual** になる
  （commit 前段で検出し登録に進まない）。plan に書いた "failed,step=register" は editItem 段の二重防御として残置。
  テストは両許容(`["failed","requires_manual"]`)で実挙動=requires_manual を確認済み。
- 画像同期は display=0(非公開)前提でベストエフォート。失敗しても移行自体は ok とし error 欄に注記する。

## 触っていない範囲（plan外・意図的に保留）
- UI パネル（商品一覧の「楽天→Yahoo 一括移行」）は **turn-002 に後置**（plan Goal の方針どおり）。
- `route.test.ts`（任意）は未追加。route は薄い配線で、判断ロジックは executor.test.ts(12ケース)が網羅するため省略。
- 既存ルート(import/register/fetch/update/upload)・既存 lib・型(turn-000 の migrate pure層)は無改変。
- ライブ全移行・本番公開(submitItem)・秘密情報アクセスは一切行っていない。
