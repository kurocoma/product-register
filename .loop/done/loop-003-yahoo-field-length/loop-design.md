# loop-design.md — 楽天→Yahoo フィールド文字数整形 eval-loop

対象: `C:\Users\hppym\dev\product-register`（正本）/ 作成 2026-06-30 / 前ループ: `.loop/done/loop-002-migrate-hardening`（完了 92→92）

## 1. ベースライン（loop-002 完了・実機緑）
lint0 / tsc0 / **vitest 201** / next build0 / pytest112。migrate 機能はコミット済み(PR #1)。

## 2. このループの受け入れ（→ acceptance.yaml AC-F01..F06）
ライブテストで判明した致命ブロッカー（楽天の長い name/path/explanation が Yahoo 文字数上限超過で editItem 拒否）を、Yahoo マッパーの文字数整形＋検証で解消。

## 3. 発見の経緯（ライブ commit テスト）
`node tests/e2e_migrate.mjs --commit` で r0101-1/r1101-1/r113-1 を実登録試行 → 3件とも it-01002(path全角20)/it-01017(name全角75)/it-01033(explanation全角500) で editItem 失敗。DB取込は成功・Yahoo未作成。

## 4. hard gate / judge gate
hard gate: acceptance.required(lint/tsc/unit/build)。judge: criteria 6軸(loop-001/002 と同一・契約固定)、threshold=90、2回連続独立PASS。

## 5. 実コード由来の接地
- フィールド値は `lib/converters/yahoo.ts` の `YahooConverter` 生成: name=display_name / path=yahoo_path / explanation=buildExplanation / headline=catch_copy_yahoo / caption / abstract 等。
- `lib/yahoo/item-mapper.ts`: `buildYahooEditItemParams`(YahooConverter→params) / `validateEditItemParams`(現状=必須有無のみ・長さ未チェック)。共有（単品 register/yahoo も使用）。
- 上限表は docs/Yahoo/02-商品登録更新-editItem.md。

## 6. 範囲
target: `lib/converters/yahoo.ts`, `lib/yahoo/item-mapper.ts`, `lib/migrate/`, `lib/product/`。
forbidden: `.env*`/secrets, `.claude/`/`.loop/`/`scripts/`, 依存/評価設定, 既存テスト削除/緩和, ライブ全移行/公開。

## 7. 完了後の実地検証（ループ外）
コード修正完了後、`node tests/e2e_migrate.mjs --commit` を再実行して r0101-1/r1101-1/r113-1 が Yahoo(display=0)へ登録できることを確認する（本ループの hard gate には含めない）。
