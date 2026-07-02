# loop-design.md — Bundle A(it-14091 本解消) + Bundle B(値域ゲート) eval-loop

対象: `C:\Users\hppym\dev\product-register` / 作成 2026-06-30 / 前ループ: `.loop/done/loop-004-yahoo-name-fix`(完了 93→92)

## 1. ベースライン
lint0 / tsc0 / **vitest 243** / next build0。文字数系ブロッカー(path/explanation/name)は実機解消済み。

## 2. このループの受け入れ（→ acceptance AC-A1..A5, AC-B1..B4, AC-C1..C2）
監査(docs/しまのや/migrate-audit-2026-06-30.md)の Bundle A(it-14091)＋Bundle B(値域ゲート)を実装。

## 3. 発見の経緯（監査・ライブ）
ライブ commit③で name 解消・**it-14091(追加画像紐づけ)** が現アクティブブロッカー。監査で根因=executor の editItem→syncImage 逆順(executor.ts:184-217)＋部分失敗連鎖＋SELLER_ID基底URLずれ(image-url.ts:4)＋レート/伝播遅延。103件スケールでは price=0(it-01023)/item_code `_`(it-01004)/非leafカテゴリ(it-01089系)が editItem を落とす。

## 4. hard gate / judge gate
hard gate: lint/tsc/unit/build。judge: criteria 6軸(契約固定)、threshold=90、2回連続独立PASS。

## 5. 実コード由来の接地（監査 evidence）
- executor.ts: 9a upsert → 9b editYahoo(184-206) → 9c syncImage(208-217)。→ syncImage を 9b の前へ。
- route.ts syncYahooImages(209-251): uploadLibImage、_productId 未使用・product 参照。
- item-image-urls: yahoo.ts:75,103 → image-url.ts:47-57(基底 okimarumarket 固定)。upload は getYahooConfig().sellerId(auth.ts:19)。→ 基底を sellerId 動的化(item-mapper/image-url 側)。
- item-mapper.ts validateEditItemParams(158-187): 必須有無＋文字数のみ。→ price 範囲/item_code 文字種/product_category 数値を追加。
- executor.test.ts:131-138: effects 期待が editYahoo→syncImage(誤順序を固定)。→ 是正(A5)。

## 6. 範囲
target: `lib/migrate/`, `app/api/migrate/`, `lib/yahoo/item-mapper.ts`, `lib/converters/image-url.ts`。forbidden: yahoo.ts(YahooConverter本体)・設定・依存・ハーネス・ライブ/公開。

## 7. 完了後の実地検証（ループ外）
`node tests/e2e_migrate.mjs --commit` で r0101-1/r1101-1/r113-1 が Yahoo(display=0)登録できる(it-14091 解消)ことを確認。
