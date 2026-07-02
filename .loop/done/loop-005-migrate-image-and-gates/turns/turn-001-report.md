# turn-001 report（loop-005）— 再検証（機能変更なし / generator 非起動）

> turn-000 が PASS(91) したため、protocol C に従い turn-001 は **コードを一切変更せず**、同一 implementation_hash のまま 2回目の独立検証を行った。本 report は司令塔が記録。

## 実行したコマンドと結果
- `python scripts/run_hard_gates.py --iteration 1` → **hard_gates_passed=true**（lint/typecheck/unit(261)/build + pytest 全 PASS、`manual_changes_detected=false`）。
- **implementation_hash = `453cc70e86ec5d49`**（turn-000 と完全一致）。
- eval-loop-evaluator（新規 fork・独立）で再採点 → **score 91 / passed=true**（correctness92 / regression_safety93 / test_quality92 / maintainability90 / integration_fit88 / risk_control90）。A5 が effects 配列1箇所のみの順序是正（緩和でない）・A3 で it-14091 根因解消 を再確認。
- `validate_eval_schema.py turn-001-eval.json` → VALID。

## 変更ファイル
- **なし**（再検証のみ）。

## 2回連続 PASS の根拠
- turn-000: score 91 / passed / hash 453cc70e…
- turn-001: score 91 / passed / hash 453cc70e…（同一）

## 未解決 / 既知リスク（本ループ・スコープ外＝次セッション繰越）
- yahoo.ts の caption imgList / 単品 item_image_urls の okimarumarket ハードコード（本番 seller==okimarumarket のため現状安全）。lib 基底URLの一元化。
- AC-B4 の executor end-to-end テスト追加（現状 generic validateYahoo missing 経由）。
- 値域ゲートが単品 register/yahoo にも適用（意図的な fail-fast・挙動変更として明記）。
- **Yahoo 実機での it-14091 最終確認はループ外（`e2e_migrate --commit`）**。

## 触っていない範囲
既存ルート/既存テスト(A5以外)/設定/依存/ハーネス・YahooConverter(yahoo.ts): 無改変。
