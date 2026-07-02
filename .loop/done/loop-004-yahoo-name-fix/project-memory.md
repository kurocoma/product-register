# project-memory.md — 再利用可能な知見（loop-004 / 継承）

## 確定した土台（実コード由来）
- Yahoo name は `lib/yahoo/item-mapper.ts buildYahooEditItemParams` → `fitYahooFieldLimits` で整形。`YAHOO_FIELD_LIMITS.name={max:75}`。`fitYahooField` は limit.html=true のとき `stripHtml` 後 `fitFullWidth`。**name は現在 html対象外＝`<br>` 残存**。
- `lib/product/text-fit.ts`: `fullWidthLen`(全角1/半角0.5・ASCII<=0x7F と半角カナ0xFF61-0xFF9F が0.5)、`fitFullWidth`(コードポイント境界保持)、`stripHtml`。
- 楽天 `display_name` は「本来の商品名 `<br>` SEOキーワード群」形式（本来名は 19〜35全角と短い）。

## ライブ知見（重要）
- loop-003 後の `e2e_migrate --commit`(r0101-1/r1101-1/r113-1): path(it-01002)/explanation(it-01033) は整形で解消。**name(it-01017) は残存** — 整形後 name=74.5〜75全角(自前カウント)でも Yahoo は >75 と判定。原因 = name の `<br>` 未除去＋自前カウントが Yahoo 実カウントより小さい(境界で約1全角の差)。
- 対策(loop-004): name を `<br>`→空白＋HTML除去し、安全マージンを引いた実効上限(<75)へ切詰。**合成データのみのテストは実データ形を見逃す** → 実データ風テスト必須(DEC-403)。
- 3商品は kurocommerce DB に取込済(productId d1df843b/a2f1c824/3bbab562)・Yahoo 未登録。修正後 `e2e_migrate --commit` で再検証。

## 環境
- グローバル guard: `*.test.*`/config の Edit/Write deny → 新規テストは Bash 作成（既存無改変）。
- ライブ実行: `webui/tests/e2e_migrate.mjs`（dev サーバ localhost:3000 稼働・kurocommerce セッション・既定 dry-run / `--commit` で実登録 display=0）。
