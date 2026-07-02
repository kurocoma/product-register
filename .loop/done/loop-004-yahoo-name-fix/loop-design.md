# loop-design.md — Yahoo 商品名(name) HTML除去＋安全切詰 eval-loop

対象: `C:\Users\hppym\dev\product-register` / 作成 2026-06-30 / 前ループ: `.loop/done/loop-003-yahoo-field-length`(完了 91→91)

## 1. ベースライン
lint0 / tsc0 / **vitest 226** / next build0。loop-003 で path/explanation/各フィールド整形は実機解消済み。

## 2. このループの受け入れ（→ acceptance.yaml AC-N01..N05）
ライブ再テストで残った name(it-01017) を、HTML除去＋安全マージン切詰（キーワード保持方針）で解消。実データ風テストで loop-003 の見逃し（合成データのみ）を防ぐ。

## 3. 発見の経緯
loop-003 後の `node tests/e2e_migrate.mjs --commit` で path/explanation は解消・name のみ失敗。診断(ディスクlib直接): 整形後 name=74.5〜75全角(自前カウント)だが Yahoo は >75。原因 = 楽天名「本来商品名 `<br>` キーワード群」の HTML 未除去＋カウント差。

## 4. hard gate / judge gate
hard gate: lint/tsc/unit/build。judge: criteria 6軸(契約固定・再利用)、threshold=90、2回連続独立PASS。

## 5. 実コード由来の接地
- `lib/yahoo/item-mapper.ts`: `YAHOO_FIELD_LIMITS`(name:{max:75}), `fitYahooFieldLimits`, `fitYahooField`(html フラグで stripHtml 後 fitFullWidth)。name は現在 html対象外＝`<br>`残存。
- `lib/product/text-fit.ts`: `fullWidthLen`(全角1/半角0.5), `fitFullWidth`(境界保持), `stripHtml`。
- 方針: name に html:true 相当(ただし `<br>`→空白に変換してキーワード区切り保持)＋安全マージン(実効上限<75)。

## 6. 完了後の実地検証（ループ外）
`node tests/e2e_migrate.mjs --commit` を再実行し r0101-1/r1101-1/r113-1 が Yahoo(display=0) に登録できる(it-01017 解消)ことを確認。
