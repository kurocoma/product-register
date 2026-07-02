# traceability.md — 要件↔変更↔検証 逆引き（loop-004 Yahoo name 整形）

| 要件 | 小目標 | 変更箇所 | 検証方法 | 実行結果 | 証拠 | 判断 |
|---|---|---|---|---|---|---|
| AC-N01 name の HTML除去 | <br>→空白・他タグ除去 | lib/product/text-fit.ts, lib/yahoo/item-mapper.ts | unit | - | - | - |
| AC-N02 安全マージン切詰 | 実効上限<75・商品名先頭保持 | lib/yahoo/item-mapper.ts | unit | - | - | - |
| AC-N03 実データ形で it-01017 解消 | 楽天風キーワード名 | 同上 | unit(実データ風) | - | - | - |
| AC-N04 後方互換 | 既存226+path/expl維持 | (既存) | webui_unit緑 | baseline226 | - | - |
| AC-N05 テスト | 新規/変更にテスト | *.test.ts | webui_unit | - | - | - |
| HG-001..004 | lint/tsc/unit/build | - | run_hard_gates | baseline緑 | - | - |
| DEC-401..404 | 設計判断 | decisions.md | - | - | decisions.md | 採用 |
