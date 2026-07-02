# traceability.md — 要件↔変更↔検証 逆引き（loop-002 本番ハードニング）

| 要件 | 小目標 | 変更箇所 | 検証方法 | 実行結果 | 証拠 | 判断 |
|---|---|---|---|---|---|---|
| AC-H01 レート制御の実配線 | route が runItems に delayMs 配線・設定可 | app/api/migrate/route.ts, lib/migrate(result/executor) | unit(待機回数) + evaluator | - | - | - |
| AC-H02 既存公開商品の display 保持 | forUpdate は display 不変・新規=0 | lib/migrate/executor.ts, route.ts | unit(existed/新規) | - | - | - |
| AC-H03 skipped 契約 honest化 | emit するか型/集計から除去 | lib/migrate/types.ts, result.ts | unit | - | - | - |
| AC-H04 大量入力ガード | チャンク/上限の運用ガード | lib/migrate, route.ts | unit(境界) | - | - | - |
| AC-H05 後方互換 | 既存189+一括フロー不変 | (既存) | webui_unit緑 | baseline189 | - | - |
| AC-H06 テスト | 新規/変更にテスト | lib/migrate/*.test.ts, route.test | webui_unit | - | - | - |
| HG-001..004 lint/tsc/unit/build | - | - | run_hard_gates | baseline緑 | - | - |
| DEC-201..204 | 設計判断 | decisions.md | - | - | decisions.md | 採用 |

要件ID: AC-H=ハードニング受入 / HG=hard gate / DEC=設計判断
