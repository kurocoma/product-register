# task.md — 楽天→Yahoo 移行 Bundle A（it-14091 本解消）＋ Bundle B（値域ゲート）

## 元依頼（ユーザー）
> 移行経路の一括監査（docs/しまのや/migrate-audit-2026-06-30.md）で残ブロッカー12件を4束に整理。ユーザー選択: **Bundle A＋B をまとめて**実装。
> 目的: it-14091 をライブで本当に解消し、103件一括移行に耐える値域ゲートを入れる。

確認済みの前提:
- 文字数系(path/explanation/name)は loop-003/004 で実機解消済み。現在のアクティブブロッカーは **it-14091（追加画像紐づけ）** のみ。
- 本セッションのゴール: **コード修正まで**＋修正後のライブ `e2e_migrate --commit` 再テスト（3件が Yahoo display=0 登録できること）。実出品(公開/submitItem)はしない。

## タスク種別
bugfix + hardening。

## 対象範囲
`webui/lib/migrate/`（executor.ts: 処理順・画像ゲート・warnings surface / executor.test.ts: 順序期待値の是正）, `webui/app/api/migrate/rakuten-to-yahoo/route.ts`（syncYahooImages: アップロード結果駆動・スロットル/リトライ）, `webui/lib/yahoo/item-mapper.ts`（validateEditItemParams 値域ゲート / item_image_urls の sellerId 動的化）, `webui/lib/converters/image-url.ts`（YAHOO_IMAGE_BASE の sellerId 動的化）。

## 非対象範囲（触らない）
`.env*`・secrets、`.claude/`・`.loop/`・`scripts/`、`package.json`/lockfile、`tsconfig`/`eslint`/`vitest`、`webui/lib/converters/yahoo.ts`(YahooConverter 本体は不変が望ましい)、ライブ全移行・本番公開。

## Bundle A（it-14091 本解消）
- **A1 順序是正（根因）**: executor commit で **syncImage（画像 lib アップロード）を editItem の前**に実行（現状 executor.ts:184-217 が editYahoo→syncImage の逆順）。route の syncImage は productId 未使用・product 参照のみ＝依存問題なし。
- **A2 画像ハード前提＋warnings 可視化**: editItem の `item_image_urls` を **実アップロード成功した画像のみ**で組み立てる（image_count 盲目ではなく upload 結果駆動）／全失敗時は status=failed。`edit.warnings`/`it-14091` を `MigrationItemResult` に surface（無検知防止）。
- **A3 lib 基底URL の sellerId 動的化**: `item_image_urls` の基底を実 sellerId(`getYahooConfig().sellerId`)から生成し upload 先(`lib/{sellerId}/...`)と参照先を一致。`image-url.ts:4` の `okimarumarket` ハードコード除去。**これにより SELLER_ID の値確認は不要**。
- **A4 レート/伝播対策**: upload→editItem 間に Yahoo API スロットル(~1s)か、`it-14091`/`im-02005` 検知時の限定リトライ(短い待機＋1回再試行)。
- **A5 テスト是正**: `executor.test.ts:131-138` の effects 期待順を **syncImage→editYahoo の正しい順**へ是正（誤順序を固定していた spec の是正＝報酬ハッキングではない。Bash で編集）。

## Bundle B（103件スケールの値域ゲート＝dry-run 前倒し）
- **B1 price**: `validateEditItemParams` で price を数値1〜99,999,999 で検証（0/非数値/範囲外→不足扱い）。it-01023 を dry-run で requires_manual 前倒し。
- **B2 item_code**: `/^[A-Za-z0-9-]+$/` かつ99文字以内で検証（`_`等→requires_manual）。it-01004 前倒し。
- **B3 product_category**: `/^[0-9]{1,10}$/` で検証。it-01089系 前倒し。
- **B4 surface**: 上記違反が migrate の dry-run/preview で **requires_manual** として出る（executor は injected validateYahoo=validateEditItemParams を preview で呼ぶ）。

## 互換性要件
既存テスト(243)・単品 register/yahoo・一括移行を壊さない。例外は **executor.test.ts の順序期待値の是正のみ**（A5・誤順序の修正）。`YahooConverter`(yahoo.ts) 本体は不変が望ましい（item_image_urls の動的化は item-mapper / image-url 側で実現）。

## セキュリティ/運用要件
- 秘密情報を読み書き・出力しない。ライブAPIはループ内で呼ばない（hard gate はオフライン）。submitItem 非実行・display=0 維持。

## 変更禁止事項
- A5 以外で既存テストを削除・スキップ・緩和・期待値改ざんしない。合格のためでなく実装是正のためのテスト修正のみ許容（A5）。
- 受け入れ条件・criteria・eval-schema を緩めない。実出品・公開を実行しない。

## 不明点と安全な仮定
- A4 のリトライ回数/待機は generator が妥当値を決めてよい（テストは sleep 注入で実時間消費しない）。
- 画像0枚（転送元なし）の商品は editItem で item_image_urls を送らない or requires_manual（取込3商品は image_count>=1）。
- ライブ実機での it-14091 最終解消確認はループ外（`e2e_migrate --commit`）。
