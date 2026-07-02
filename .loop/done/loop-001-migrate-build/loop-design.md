# loop-design.md — 楽天→Yahoo一括移行 機能の eval-loop 設計

対象リポジトリ: `C:\Users\hppym\dev\product-register`（正本・git remote: kurocoma/product-register）
作成: 2026-06-29 / 司令塔: Claude Code

## 1. このリポジトリで使える検証コマンド（ベースライン緑を実機確認済み）
| ゲート | コマンド | cwd | ベースライン |
|---|---|---|---|
| webui_lint | `npm run lint` | webui | exit 0 ✓ |
| webui_typecheck | `npx tsc --noEmit` | webui | exit 0 ✓ |
| webui_unit | `npm run test`（vitest） | webui | 139 passed ✓ |
| webui_build | `npm run build`（next build） | webui | exit 0 ✓ |
| python_tests (optional) | `python -m pytest -q` | . | CLI側回帰確認 |
- ライブAPI必須の `tests/e2e_*.mjs`（23本）・`verify_*` 実機型は**自動hard gateから除外**（dry-run/テスト商品で別途確認）。

## 2. このタスクの受け入れ条件（→ acceptance.yaml の behavioral_acceptance AC-001..009）
楽天管理番号リストを入力に、各楽天商品を取込→（カテゴリ対応）→Yahoo安全登録→画像転送する一括パイプライン。
per-item 結果＋summary、安全既定（display:0/在庫0）、失敗継続、カテゴリnull安全化、dry-run非書込、後方互換、ne_code重複排除、多SKU/高度設定の安全スキップ、純粋ロジックの単体テスト。

## 3. hard gate（機械判定）
acceptance.yaml の `hard_gates.required`（lint/typecheck/unit/build）。全 exit 0 で hard_gates_passed=true。
LLM の高得点で上書き不可。失敗時 passed=false（record_eval が再計算）。

## 4. judge gate（LLM evaluator 採点）
criteria.yaml の6軸（correctness/regression_safety/test_quality/maintainability/integration_fit/risk_control）。
threshold=90、2回連続独立PASSで完了。

## 5. 触ってよい範囲（target_paths）
`webui/lib/migrate/`（新規）, `webui/app/api/migrate/`（新規）, `webui/components/product/`（UIパネル追加）,
`webui/lib/converters/`, `webui/lib/rakuten/`, `webui/lib/yahoo/`, `webui/lib/product/`（既存ロジックの関数抽出・再利用）。

## 6. 触ってはいけない範囲（non_target_paths / forbidden）
`.env*` / secrets / 本番設定、`.claude/`・`.loop/`・`scripts/`（eval-loop ハーネス自身）、
`package.json`・lockfile（依存変更）、`tsconfig.json`・`eslint.config.mjs`・`vitest.config.ts`（評価基準）、
既存テストの削除・緩和、ライブ全移行の実行・本番公開（このセッションのスコープ外）。

## 7. 既存仕様・互換性上の注意点（実コード+メモリ由来）
- 取込: `POST /api/import/[mall]` `{code}` → `getRakutenItem`/`parseRakutenItem` → `buildImportedProduct` → ne_code重複排除(`existed`)。
- Yahoo登録: `/api/register/yahoo/[id]` GET=dry-run / POST=commit。既定 publish=false→display:0。**editItem は未送信項目を既定上書き**するためラウンドトリップ必須。
- 画像: `POST /api/upload/yahoo-sync/[id]`（取込画像→Yahoo lib。無いと `it-14091`）。
- カテゴリ: `fetchYahooCategoryMapping`（楽天ジャンル→Yahoo。null時は手動）。
- Yahoo新規ページは submitItem 不可（`it-07004`）。公開反映は別運用（本セッションは公開しない）。
- 多SKU(variants)/Yahoo高度設定は誤登録防止のため安全スキップ。

## 8. タスクの成功を2回連続検証する方法
record_eval が判定。**同一 implementation_hash かつ同一契約(acceptance/criteria/schema/validator)**での連続PASSのみ計数。
1度passedになったら次周は機能変更せず再検証だけで2回目の独立PASSを取る。validation/runs に2回分のreport。

## 9. 不明点と安全な仮定
- 入力フォーマット: 管理番号の「配列 / 改行テキスト / CSV1列」を受理する想定（安全な仮定）。
- 公開状態: 本セッションは安全状態のみ（display:0/在庫0）。公開は別途ユーザー操作（確定済み）。
- 商品ソース: ユーザーが管理番号リストを渡す（確定済み）。RMS全件自動列挙は今回スコープ外。

## 10. 外部ブロッカー
- ライブ検証（実モールAPI）は OAuth/ESA 認証と本番リスティング生成を伴うため自動hard gateから除外（このセッションの完了条件には含めない）。
- eval-loop の自走には `dev\product-register` でセッションを開き直し `/hooks` で hook 信頼が必要（settings.json は報酬ハッキング防止ガードで自動編集不可 → `.claude/eval-loop.hooks.json` をマージ）。
