# project-memory.md — 再利用可能な知見（loop-002 / loop-001 から継承）

## 確定した土台（実コード由来）
- 一括移行: `POST /api/migrate/rakuten-to-yahoo {manageNumbers,dryRun=true,publish=false,continueOnError=true}` → `parseManageNumbers` → `makePerItemExecutor(deps,{dryRun,publish})` を `runItems` → `aggregate` → `{ok,dryRun,publish,results,summary,invalid,duplicatesRemoved}`。
- executor(lib/migrate/executor.ts): 依存注入。dry-run は副作用ゼロ(status="migrate")。commit は buildImported→findExisting→upsert→buildYahooParams(forceDisplay)→validate→editItem→image→history。category=null/多SKU(variants>1)/yahoo_grouping_enabled は requires_manual。
- `runItems`(result.ts): 任意 `delayMs`/`sleep`(注入可・既定0=遅延なし) を実装済み。**route は未配線**（AC-H01 の核）。
- `aggregate`(result.ts): status "ok" と "migrate" を migrated に計上（loop-001 で修正）。`ItemStatus 'skipped'` は型に在るが未 emit（dead path）。
- Yahoo `editItem` は在庫列なし → 安全機構は display=0（submitItem 非実行）。forceDisplay 規約は register/yahoo route と同じ `publish?undefined:"0"`。
- 既存重複排除 `findExistingProduct`: products を `extra->>rakuten_manage_number` 優先→`ne_code`、各 `limit(1)`。import route と migrate route に重複実装。

## 環境/運用
- ベースライン(loop-001完了): lint0/tsc0/vitest189/next build0/pytest112。
- グローバル guard(`~/.claude/hooks/pretool_global_guard.py`): Edit/Write で `*.test.*`/`*.spec.*`/tsconfig/eslint/.claude/settings を deny。**新規テストは Bash 作成で回避可（ユーザー承認済み・既存テストは無改変）**。Bash 危険パターン(rm -rf 等)も deny。
- hook/スクリプトは UTF-8 強制出力（cp932 クラッシュ対策）。Python 3.13 + PyYAML。

## 再発防止
- 「status の取りうる値」と「集計関数の case」「実 emit 箇所」は対で確認（dead status の再発防止）。
- 実装済みの機能(delayMs 等)が **呼び出し側で未配線**になっていないか、route↔lib の配線を必ず確認。
