# traceability.md — 要件↔変更↔検証 逆引き（loop-003 Yahoo フィールド文字数整形）

| 要件 | 小目標 | 変更箇所 | 検証方法 | 実行結果 | 証拠 | 判断 |
|---|---|---|---|---|---|---|
| AC-F01 全角切詰ヘルパ | 全角1/半角0.5・境界保持 | lib/product(新ヘルパ) | unit(境界) | - | - | - |
| AC-F02 各フィールド上限整形 | name75/path20/expl500/headline30等 | lib/converters/yahoo.ts, lib/yahoo/item-mapper.ts | unit | - | - | - |
| AC-F03 it-01002/01017/01033 解消 | 長入力→整形後制限内 | 同上 | unit(長入力) | - | - | - |
| AC-F04 dry-run 事前検知 | 文字数違反/欠落→requires_manual | item-mapper(validate), lib/migrate | unit | - | - | - |
| AC-F05 後方互換 | 既存201+単品不変 | (既存) | webui_unit緑 | baseline201 | - | - |
| AC-F06 テスト | 新規/変更にテスト | *.test.ts | webui_unit | - | - | - |
| HG-001..004 | lint/tsc/unit/build | - | run_hard_gates | baseline緑 | - | - |
| DEC-301..305 | 設計判断 | decisions.md | - | - | decisions.md | 採用 |

要件ID: AC-F=本ループ受入 / HG=hard gate / DEC=設計判断
