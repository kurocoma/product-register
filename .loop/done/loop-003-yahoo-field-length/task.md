# task.md — 楽天→Yahoo 移行のフィールド文字数整形

## 元依頼（ユーザー）
> （loop-002 完了後）テストで3アイテムだけ実行（commit）移行 → **実ブロッカー発見**：楽天の長い商品名/パス/説明が Yahoo の文字数上限を超過し `editItem` が拒否（3件とも Yahoo 未登録 / it-01002 path・it-01017 name・it-01033 explanation）。
> ユーザー選択: **文字数整形を実装（新 eval-loop）**。

確認済みの前提:
- ライブテスト(node tests/e2e_migrate.mjs --commit)で r0101-1/r1101-1/r113-1 が DB取込は成功・Yahoo editItem は文字数超過で失敗。Yahoo 側は未作成（無傷）。3件はアプリDB(kurocommerce)に残存（修正後に再テスト可）。
- 本セッションのゴール: **コード修正まで**（整形＋文字数検証＋テスト）。実出品(ライブ commit / 公開)はしない。

## タスク種別
bugfix（楽天→Yahoo 移行の致命ブロッカー修正。共有 Yahoo マッパーの文字数整形）。

## 対象範囲
`webui/lib/converters/yahoo.ts`（YahooConverter のフィールド生成）, `webui/lib/yahoo/item-mapper.ts`（buildYahooEditItemParams/validateEditItemParams）, `webui/lib/migrate/`（dry-run 検知連携）, `webui/lib/product/`（全角切詰ヘルパ新設可）。

## 非対象範囲（触らない）
`.env*`・secrets、`.claude/`・`.loop/`・`scripts/`、`package.json`/lockfile、`tsconfig`/`eslint`/`vitest`、既存テストの削除/緩和、ライブ全移行・本番公開。

## Yahoo editItem フィールド上限（docs/Yahoo/02 より・authoritative）
- `name` 全角75 / `path` ストアカテゴリパス（コロン`:`区切り・各カテゴリ名 全角20・8階層以内）/ `headline` 全角30(HTML不可) / `explanation` 全角500(HTML不可・検索対象) / `abstract` 全角500 / `caption` 全角5000 / `additional1-3` 全角5000 / `meta_desc` 全角80 / `variation*_name` 全角28 / `product_category` 数字10 / `item_code` 半角99 / `price` 数字8。
- 全角カウント = 全角1・半角0.5（「全角75=半角150」）。

## 取り組む内容
1. **全角ベースの切詰ヘルパ**（全角=1/半角=0.5、境界で全角文字/サロゲートを割らない）。
2. **各フィールドの上限適合整形**（name/explanation(HTML除去)/headline(HTML除去)/abstract/meta_desc/caption/path セグメント等）。**制限内は無変更**。
3. **文字数バリデーション**（validateEditItemParams 等）で超過/欠落を検知 → migrate の dry-run/preview で requires_manual として surface（commit で初めて落ちない）。
4. 共有マッパー経由で**単品 register/yahoo にも整形が効く**。

## 互換性要件
既存の単品 register/yahoo・一括移行・既存テスト(201本)を壊さない。短いフィールドの出力は不変。

## セキュリティ/運用要件
- 秘密情報を読み書き・出力しない。ライブ API は呼ばない（本ループはコード修正のみ）。
- 整形は情報を過度に欠落させない（語境界/意味を可能な範囲で保つ）。

## 変更禁止事項
- 合格のためにテストを削除・スキップ・緩和しない。実装を直す。
- 受け入れ条件・criteria・eval-schema を緩めない。
- 雑な切詰で情報を壊さない。実出品・本番公開を実行しない。

## 不明点と安全な仮定
- `path`（ストアカテゴリパス）の意味整合（product_category とは別概念）は深い論点だが、本ループは「各セグメントを全角20・コロン区切り・8階層に整形」で editItem 適合を担保する（ストアカテゴリ設計の最適化は別途）。
- explanation/headline は HTML 不可 → タグ除去後に文字数整形。caption(HTML可)は除去しない。
