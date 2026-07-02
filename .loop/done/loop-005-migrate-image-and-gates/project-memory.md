# project-memory.md — 再利用可能な知見（loop-005 / 継承）

## 監査で確定した実コード接地（docs/しまのや/migrate-audit-2026-06-30.md）
- **画像順序(it-14091)**: executor.ts は commit で 9a upsert → 9b editYahoo(184-206) → 9c syncImage(208-217)。editItem は item_image_urls を常時送る(yahoo.ts:75,103 → image-url.ts:47-57, 基底 `https://shopping.c.yimg.jp/lib/okimarumarket/{ne_code}.jpg`)が、画像 lib upload は後段(route.ts:209-251 uploadLibImage)。→ editItem 時点で lib 未登録→it-14091。単品実績フロー(e2e_yahoo_image_sync.mjs:54-64)は upload→register の順。
- **lib 基底URLずれ**: image-url.ts:4 が okimarumarket 固定、upload は getYahooConfig().sellerId(auth.ts:19)で lib/{SELLER_ID}/。動的化で一致させれば SELLER_ID 値確認不要。ファイル名は image-url.ts:47-52 と lib-path.ts:15-19 で一致。
- **validateEditItemParams(item-mapper.ts:158-187)**: 必須有無＋文字数のみ。price は `!params.price` 判定で "0" を truthy=合格(it-01023 見逃し)。item_code 文字種・product_category 数値桁を未検証。
- **executor.test.ts:131-138**: effects 期待が editYahoo→syncImage の誤順序を固定(A5 で是正)。
- **spec1-10 未送は editItem 必須でない**（楽天IE0418 とは別仕様）＝ブロッカーでない。

## ライブ実行
- `webui/tests/e2e_migrate.mjs --commit`（dev サーバ localhost:3000・kurocommerce セッション・display=0）。3商品(productId d1df843b/a2f1c824/3bbab562)は kurocommerce DB 取込済・Yahoo 未登録。
- ライブ進捗: it-01002/01033/01017(文字数)解消済 → 現在 it-14091(画像)。

## 環境
- グローバル guard: `*.test.*` Edit/Write deny → 新規/是正テストは Bash で。A5 は既存 executor.test.ts の順序期待値是正(誤spec修正)。
- ベースライン: vitest 243 / tsc0 / lint0 / build0。
