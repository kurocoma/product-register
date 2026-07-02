# loop-design.md — 楽天→Yahoo 一括移行：本番ハードニング eval-loop

対象リポジトリ: `C:\Users\hppym\dev\product-register`（正本）
作成: 2026-06-30 / 司令塔: Claude Code / 前ループ: `.loop/done/loop-001-migrate-build`（完了 score92→91）

## 1. ベースライン（loop-001 完了時点・実機緑）
| ゲート | コマンド | cwd | ベースライン |
|---|---|---|---|
| webui_lint | `npm run lint` | webui | exit 0（warning8件は既存）|
| webui_typecheck | `npx tsc --noEmit` | webui | exit 0 |
| webui_unit | `npm run test` | webui | **189 passed** |
| webui_build | `npm run build` | webui | exit 0 |
| python_tests(optional) | `python -m pytest -q` | . | 112 passed |

## 2. このループの受け入れ（→ acceptance.yaml AC-H01..H06）
loop-001 の独立 evaluator が挙げた recommended_next_changes を実装し、実バルク移行に備えて堅牢化する。
レート制御の実配線 / 既存公開商品の display 保持 / skipped契約の honest化 / 大量入力ガード / 後方互換 / テスト。

## 3. hard gate
acceptance.yaml の required(lint/typecheck/unit/build)。全 exit 0 で hard_gates_passed=true。LLM 高得点で上書き不可。

## 4. judge gate
criteria.yaml の6軸（loop-001 と同一・契約固定）。threshold=90、2回連続独立PASSで完了。

## 5. 既存仕様・整合上の注意（実コード由来）
- `runItems`(result.ts) は `delayMs`/`sleep`(注入可) を既に実装・単体テスト済み。**route が未配線**なのを直すのが AC-H01 の核。
- 既存 register/yahoo route の forceDisplay 規約: `publish ? undefined : "0"`。既存(forUpdate)商品も '0' を送ると非表示化 → AC-H02 で既存は保持を既定に。
- executor.ts の dry-run は副作用ゼロ・status="migrate"。aggregate は "migrate"/"ok" を migrated に計上（loop-001 で修正済み）。
- `ItemStatus 'skipped'` は型に在るが未 emit（dead）→ AC-H03。
- 公開(submitItem)は本セッションでも非実行。

## 6. 触ってよい/いけない範囲
target: `webui/lib/migrate/`, `webui/app/api/migrate/`, `webui/components/product/`, `webui/lib/product/`。
forbidden: `.env*`/secrets/本番設定, `.claude/`/`.loop/`/`scripts/`, 依存/評価設定, 既存テスト削除/緩和, ライブ全移行・本番公開。

## 7. 2回連続検証
record_eval が判定。同一 implementation_hash かつ同一契約での連続 PASS のみ計数。1度passed後は機能変更せず再検証で2回目を取る。
