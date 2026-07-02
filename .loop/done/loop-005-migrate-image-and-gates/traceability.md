# traceability.md — 要件↔変更↔検証 逆引き（loop-005 Bundle A+B）

| 要件 | 小目標 | 変更箇所 | 検証方法 | 実行結果 | 証拠 | 判断 |
|---|---|---|---|---|---|---|
| AC-A1 順序是正 | syncImage を editItem の前 | lib/migrate/executor.ts | unit(順序) | - | - | - |
| AC-A2 画像ゲート/warnings | 成功画像のみ参照/全失敗→failed/warnings surface | executor.ts, route.ts, item-mapper.ts | unit | - | - | - |
| AC-A3 lib基底URL動的化 | sellerId 反映 | lib/converters/image-url.ts, item-mapper.ts | unit | - | - | - |
| AC-A4 レート/リトライ | スロットル/it-14091リトライ | route.ts, executor.ts | unit(sleep注入) | - | - | - |
| AC-A5 テスト是正 | 期待順 syncImage→editYahoo | lib/migrate/executor.test.ts | webui_unit | - | - | - |
| AC-B1 price ゲート | 1〜99,999,999 | lib/yahoo/item-mapper.ts | unit | - | - | - |
| AC-B2 item_code ゲート | 英数ハイフン99字 | 同上 | unit | - | - | - |
| AC-B3 category ゲート | 数値10桁 | 同上 | unit | - | - | - |
| AC-B4 dry-run surface | 違反→requires_manual | executor.ts | unit | - | - | - |
| AC-C1/C2 互換・テスト | 既存243±A5+新規緑 | (既存) | webui_unit | baseline243 | - | - |
| HG-001..004 | lint/tsc/unit/build | - | run_hard_gates | baseline緑 | - | - |
| DEC-501..505 | 設計判断 | decisions.md | - | - | decisions.md | 採用 |
