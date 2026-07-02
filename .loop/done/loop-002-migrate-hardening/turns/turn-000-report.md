# turn-000 report（loop-002 本番ハードニング・report は司令塔が要約保存）

> generator(eval-loop-generator) が maxTurns 制約で report 未記載のまま終了したため、protocol に従い司令塔が成果物と検証結果を要約保存。実装は generator が実施。

## 実行したコマンドと結果（4ゲート・cd webui）
- `npx tsc --noEmit` → exit 0
- `npm run lint` → exit 0（warning 8件は既存ファイルのみ。変更/新規に警告・エラー無し）
- `npm run test` → exit 0 / **29 files / 201 tests passed**（loop-001 の189 + 新規12）
- `npm run build` → exit 0（`/api/migrate/rakuten-to-yahoo` 健全）

## 変更/追加ファイル（何を・なぜ）
- `webui/app/api/migrate/rakuten-to-yahoo/route.ts`（変更）: **AC-H01** body `delayMs`(既定300>0・>=0で上書き可・不正は300に丸め)を `runItems(..., {continueOnError, delayMs})` へ配線しレスポンスに含める。**AC-H04** `MAX_ITEMS=200`、`valid.length>200` で 400(件数メッセージ・runItems 非実行)。**AC-H02 配線** body `preserveExistingDisplay`(既定true)を executor へ。
- `webui/lib/migrate/executor.ts`（変更）: **AC-H02** opts に `preserveExistingDisplay`(既定true)。forceDisplay を per-item 計算へ移動 `(existed && preserveExistingDisplay) ? undefined : (publish?undefined:"0")` → 既存(forUpdate)は display 不送=保持、新規は "0"。
- `webui/lib/migrate/result.ts`（変更）: **AC-H03** `runItems` の continueOnError=false で item が failed を返したら残りを `status="skipped"`(ok=false, error="…中断…")で積む。continueOnError=true(既定)の挙動は不変。`aggregate` は skipped を計上(既存)。
- `webui/app/api/migrate/rakuten-to-yahoo/route-rate.test.ts`（新規・Bash）: `vi.mock("@/lib/migrate", io→{...actual,runItems:spy})` で runItems をスパイ。delayMs=300/0/不正→300・>200で400+件数・runItems 非呼出。
- `webui/lib/migrate/executor-display.test.ts`（新規・Bash）: existed→forceDisplay undefined / 新規→'0' / preserve:false&existed→'0' / publish→undefined。
- `webui/lib/migrate/result-skip.test.ts`（新規・Bash）: continueOnError=false の skipped emit・順序・aggregate / true で skipped=0 / requires_manual は中断しない。

## 未解決 / 既知リスク
- `findExistingProduct` の共有 lib 抽出は任意(DEC-204)のため未実施（import route 無改変を優先）。
- 大量入力は MAX_ITEMS=200 の運用ガード（チャンク自動分割ではなく明示拒否）。しまのや103件は通過。

## 触っていない範囲
既存テスト(*.test.*)無改変・新規は Bash 作成。設定/依存/ハーネス・既存単品ルート・import route: 未変更。
