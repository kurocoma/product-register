# turn-000 plan（loop-002 本番ハードニング）

## Goal
loop-001 の繰越（recommended_next_changes）を実装し、実バルク移行に備えて堅牢化する。本周で AC-H01〜H04 を一括投入し、AC-H05(後方互換)/H06(テスト) を維持。最小差分・既存無破壊。新規テストは Bash 作成（既存 *.test.* は無改変）。

## Analysis
- ベースライン: loop-001 完了実装（lint0/tsc0/unit189/build0）。
- 実在シグネチャ（loop-001 実コード）:
  - `webui/lib/migrate/executor.ts`: `makePerItemExecutor(deps, opts:{dryRun?,publish?})`。`forceDisplay` は**ファクトリ直下(l.79)で1回計算**され preview(l.127)/commit(l.168) で使用。`existed` は per-item(l.123-124)で判明。
  - `webui/lib/migrate/result.ts`: `runItems(items, perItem, {continueOnError=true, errorStep, delayMs=0, sleep=defaultSleep})`。`delayMs>0` で item 間に sleep。`aggregate` は ok/migrate→migrated, requires_manual, skipped, failed を集計。
  - `webui/app/api/migrate/rakuten-to-yahoo/route.ts`: l.135-139 `runItems(valid.map(...), executor, {continueOnError})` ← **delayMs 未配線**。body は `{manageNumbers,dryRun,publish,continueOnError}`。
  - `webui/lib/migrate/types.ts`: `ItemStatus` に `'skipped'`（未 emit=dead）。
- forceDisplay 規約(register/yahoo route): `publish?undefined:"0"`、buildYahooEditItemParams は forceDisplay=undefined かつ forUpdate=true なら display を送らず**既存表示を保持**。

## Changes
### AC-H01 レート制御の実配線（最優先）
- `route.ts`: body から `delayMs?:number` を受理。`const delayMs = typeof body.delayMs==="number" && body.delayMs>=0 ? body.delayMs : 300;`（安全な既定 300ms）。`runItems(..., { continueOnError, delayMs })` に配線（dry-run でも resolveRakutenItem の getItem 連打に同 delay が掛かる）。レスポンスに `delayMs` を含め可視化。
  なぜ: 実装済み delayMs が production 未発火だった核を直す（過負荷防止 AC-H01）。
- 新規/追記テスト（Bash 作成 `webui/app/api/migrate/rakuten-to-yahoo/route.test.ts` は既存=編集不可 → **別ファイル** `route-rate.test.ts` を新規作成）: `vi.mock("@/lib/migrate", importOriginal => ({...actual, runItems: vi.fn(actual.runItems)}))` で runItems をスパイ（実挙動維持）。delayMs 未指定→runItems が delayMs>0(=300) で呼ばれる / body.delayMs=0→0 で呼ばれる、を assert。

### AC-H02 既存公開商品の display 保持
- `executor.ts`: opts に `preserveExistingDisplay?:boolean`（既定 true）を追加。**forceDisplay をファクトリ直下から per-item 計算へ移動**: `existed` 確定後に `const forceDisplay = (existed && preserveExistingDisplay) ? undefined : (publish ? undefined : "0");`。preview(l.127)/commit(l.168) の buildYahooParams 両方で同値を使う。→ 既存(forUpdate)は display 不送=保持、新規は "0"。
- `route.ts`: body `preserveExistingDisplay?:boolean`（既定 true）を executor へ渡す。
  なぜ: バルク移行で公開中の Yahoo 商品を非表示化しない（AC-H02 / DEC-203）。
- 新規テスト `webui/lib/migrate/executor-display.test.ts`（Bash 作成）: existed=true→buildYahooParams が forceDisplay=undefined で呼ばれる / 新規(existed=false)→'0' / preserveExistingDisplay:false かつ existed=true→'0'(従来) / publish=true→undefined。

### AC-H03 skipped 契約の honest化（emit）
- `result.ts runItems`: **continueOnError=false** のとき、ある item が失敗(ok=false/throw)したら **残りの item を処理せず status='skipped'** で結果に積む（step は 'import' 等の未到達, ok=false, error='前段の失敗により中断（continueOnError=false）'）。これで 'skipped' が実条件で emit され dead path が解消。continueOnError=true（既定）の挙動は不変（既存テスト保護）。
  なぜ: 型契約を実態に一致（AC-H03）。`aggregate.skipped` が意味を持つ。
- 新規テスト `webui/lib/migrate/result-skip.test.ts`（Bash 作成）: continueOnError=false で2件目が失敗→3件目以降 status='skipped'、summary.skipped 計上、順序保持。continueOnError=true では skipped=0（回帰確認）。

### AC-H04 大量入力ガード
- `route.ts`: `valid` 件数が上限超過なら明示拒否。`const MAX_ITEMS=200; if (valid.length>MAX_ITEMS) return 400 {ok:false,error:"対象が多すぎます(N件)。${MAX_ITEMS}件以下に分割してください",count:valid.length}`。（しまのや103件は通過。pathological な巨大入力でのタイムアウト/部分commit を防ぐ運用ガード）。
  なぜ: 単一同期HTTPでの大量処理タイムアウト・部分commit リスクの軽減（AC-H04）。
- テスト: 上記 `route-rate.test.ts` 内で valid>200→400・件数メッセージを assert（少数入力は通常処理を確認）。

### 後方互換（AC-H05/H06）
- 既存ファイルの変更は `executor.ts`(forceDisplay移動+opt)・`result.ts`(runItems skipped分岐+delay既存)・`route.ts`(delayMs/preserve/cap 配線) のみ。既存 *.test.* は無改変・全緑維持。新規テストは Bash 作成。

## Pre-submission checks（generator が提出前に実行）
- `cd webui && npx tsc --noEmit` → 0
- `cd webui && npm run lint` → 0
- `cd webui && npm run test` → 既存189 + 新規が全緑
- `cd webui && npm run build` → 0

## 優先と budget（generator 向け）
AC-H01→H02→H03→H04 の順。ターンが尽きそうなら最低 H01+H02 を完了し4ゲート緑を確保、未完は report と最終要約に正直に記す。既存テストは編集・緩和しない（実装を直す）。
