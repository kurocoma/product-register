# task.md — 楽天→Yahoo 一括移行：本番ハードニング

## 元依頼（ユーザー）
> （前ループで「楽天市場のしまのやの商品をYahoo shoppingにも販売したい／商品編集(商品管理)の一括移行機能として追加」を機能構築＋安全検証まで完了。score 92→91 の2回連続PASSで完了 = `.loop/done/loop-001-migrate-build`）
> 続けて選択 (A): **本番ハードニングを続ける — 繰越1〜3を新しい eval-loop で対応（実バルク移行に備える）**。

確認済みの前提:
- 作業リポジトリ: `dev\product-register`（正本）。
- ベースライン: loop-001 完了時点の実装（`webui/lib/migrate/*`, `webui/app/api/migrate/rakuten-to-yahoo/route.ts`, `webui/components/product/MigratePanel.tsx`）。hard gate 緑(lint/tsc/unit189/build)。
- 本セッションのゴール: **本番バルク移行に備えた堅牢化まで**。実際のしまのや商品のライブ出品・本番公開はしない（submitItem 非実行・dry-run 既定維持）。

## タスク種別
hardening（既存の一括移行機能の本番堅牢化。loop-001 の独立 evaluator が挙げた recommended_next_changes を実装）。

## 対象範囲
`webui/lib/migrate/`（executor/result/types 等）, `webui/app/api/migrate/`（route）, `webui/components/product/`（MigratePanel・必要時）, `webui/lib/product/`（共有 helper 抽出する場合）。

## 非対象範囲（触らない）
`.env*`・secrets・本番設定、`.claude/`・`.loop/`・`scripts/`、`package.json`/lockfile、`tsconfig.json`/`eslint.config.mjs`/`vitest.config.ts`、既存テストの削除/緩和、ライブ全移行の実行・本番公開。

## 取り組む繰越項目（loop-001 DEC-011 / evaluator recommended_next_changes）
1. **レート制御の実配線（最優先・AC-H01）**: `runItems` は delayMs/sleep を実装・テスト済みだが `route.ts:135-139` の呼び出しが delayMs を渡しておらず production で過負荷防止が未発火。commit 経路で delayMs を配線し、body で調整可・安全な既定>0 にする。dry-run の楽天 getItem 連打にも配慮。route.test で sleep 注入による待機回数を検証。
2. **既存公開商品の display 保持（AC-H02）**: 現状 commit は既存(forUpdate)商品にも forceDisplay='0' を強制し、公開中の Yahoo 商品を非表示化する副作用。既存は display を保持するオプションを提供し既定で保持（新規は display=0 維持）。
3. **契約の honest化・堅牢化（AC-H03/H04）**: `ItemStatus 'skipped'` が未使用(dead) → 実条件で emit するか型/集計から除去。大量入力のチャンク/バッチ or 推奨上限の運用ガード（タイムアウト/部分commit対策）。

## 任意（必須ACにしない）
- `findExistingProduct` の共有 lib 抽出（import/migrate 重複解消）。**既存 import route の外部挙動を変えない**範囲でのみ。回帰リスクが高いので無理に行わない。

## 互換性要件
既存の一括移行(AC-001..009)・単品ルート・既存テスト(189本)を壊さない。共有化/抽出時も既存外部挙動は不変。

## セキュリティ/運用要件
- 既定は安全状態を維持（新規 display:0、submitItem 非実行＝公開しない、dry-run 非書込）。
- レート制御でモールAPIに過負荷をかけない。大量入力でタイムアウト/部分commit を起こしにくくする。
- 秘密情報を読み書き・出力しない。

## 変更禁止事項
- 合格のためにテストを削除・スキップ・緩和しない。実装を直す。
- 受け入れ条件・criteria・eval-schema を緩めない。
- 既存公開商品を意図せず非表示化しない。ライブ全移行・本番公開を実行しない。

## 不明点と安全な仮定
- 既存公開商品の display は「保持」を既定とする（公開中商品を守る）。新規は display=0。明示 publish 時のみ公開相当（本セッションでは使わない）。
- delayMs の既定は保守的な正の値（例 200–500ms）。body で上書き可。
- 大量入力は推奨上限を超えたら明示的に分割を促す or チャンク処理する（黙って全件同期処理してタイムアウトさせない）。
