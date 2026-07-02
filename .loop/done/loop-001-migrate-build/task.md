# task.md — 楽天商品の Yahoo!ショッピング一括移行機能

## 元依頼（ユーザー）
> 楽天の商品を Yahoo shopping へ移行するための機能を追加したい。今回行いたいことは「しまのや」の商品をすべて Yahoo shopping で販売することだ。

確認済みの前提（ユーザー回答）:
- 作業リポジトリ: `dev\product-register`（正本）。
- このセッションのゴール: **機能構築＋安全検証まで**（dry-run＋テスト商品 display:0/在庫0）。ライブ全移行・本番公開はしない。
- 移行対象の集合: ユーザーが **楽天の管理番号リスト** を渡す → その分だけ移行。
- 合成方式: 案A（per-item を `lib/` 関数化し、新ルート `/api/migrate/rakuten-to-yahoo` がプロセス内で順次処理。安全既定。UIパネル追加）。

## タスク種別
feature（新機能。既存の単品「楽天→Yahoo」フローのバルク化）。

## 対象範囲
`webui/lib/migrate/`（新規）, `webui/app/api/migrate/`（新規）, `webui/components/product/`（UIパネル）,
既存の取込/登録/画像/カテゴリロジックの関数抽出・再利用（`webui/lib/{converters,rakuten,yahoo,product}`）。

## 非対象範囲（触らない）
`.env*`・secrets・本番設定、`.claude/`・`.loop/`・`scripts/`（eval-loop ハーネス）、`package.json`/lockfile（依存追加）、
`tsconfig.json`/`eslint.config.mjs`/`vitest.config.ts`（評価基準）、既存テストの削除/緩和、ライブ全移行の実行・本番公開。

## 期待されるユーザー可視挙動（user-visible behavior）
- 商品一覧画面に「楽天→Yahoo 一括移行」パネル。楽天管理番号を改行/CSVで貼り付け → **dry-run プレビュー**（per-item: 取込要否/既存/カテゴリ対応有無/Yahoo検証可否/画像有無）→ **実行（安全状態で登録）** → 結果テーブル（成功/失敗/要手動・理由付き）。
- API: `POST /api/migrate/rakuten-to-yahoo`（dry-run 既定、commit はフラグ）。per-item 結果＋summary を返す。

## 互換性要件
既存の単品ルート（import/register/fetch/update/upload）と既存テスト（vitest 139本）を壊さない。関数抽出する場合も既存ルートの外部挙動は不変。

## セキュリティ/運用要件
- 既定は安全状態（Yahoo display:0 / 在庫0、publish=false）。公開は明示フラグ時のみ（本セッションでは使わない）。
- 秘密情報を読み書き・出力しない。レート制御・失敗継続でモールAPIに過負荷をかけない。
- dry-run は DB/モールへ書き込まない。

## ドキュメント要件
新モジュールには簡潔な docstring/コメント（既存コードの密度に合わせる）。運用注意は決定時に decisions.md。

## 変更禁止事項
- 合格のためにテストを削除・スキップ・緩和しない。実装を直す。
- 受け入れ条件・criteria・eval-schema を緩めない。
- カテゴリ未対応のまま誤カテゴリで登録しない。多SKU/高度設定を黙って誤登録しない。

## 不明点と安全な仮定
- 入力は「管理番号の配列 / 改行テキスト / CSV1列」を受理（安全な仮定。重複/空行は無視）。
- 1管理番号=1楽天商品ページ。多SKUは検出して安全スキップ＋要手動記録。
- カテゴリ対応が無い商品は登録せず要手動記録。
