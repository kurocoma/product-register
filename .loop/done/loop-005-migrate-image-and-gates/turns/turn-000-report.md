# turn-000 generator report

## 実行したコマンドと結果（cd webui の4ゲート）
- `npx tsc --noEmit` → pass（exit 0・型エラー0）
- `npm run lint` → pass（exit 0・0 errors / 8 warnings＝全て既存ファイル由来。新規追加ファイルの warning は0）
- `npm run test`（vitest run）→ pass（exit 0・Test Files 36 passed / Tests 261 passed。243 既存＋18 新規）
- `npm run build`（next build）→ pass（exit 0）

## 変更ファイル
- `webui/lib/migrate/executor.ts`:
  - ExecutorDeps を後方互換拡張 — `syncImage` 戻り値に `uploaded?: number[]`（成功 index）／`buildImageUrls?(neCode, indices)`／`sleep?(ms)` を任意で追加。未注入は従来挙動。
  - commit 順を是正（A1）— upsert → **syncImage（editItem の前）** → item_image_urls 再構築 → editItem → recordHistory。it-14091 の根因（逆順）を解消。
  - 画像ゲート（A2）— `uploaded` が返り、対象画像あり(image_count>=1)なのに成功0なら status=failed（壊れURLで登録しない）。`buildImageUrls` 注入時のみ成功 index のみで `editParams.item_image_urls` を上書き（0枚は項目を送らない）。editItem 成功時の `warnings`(it-14091等)を結果 error/note へ surface。
  - リトライ（A4）— editItem が it-14091/im-02005 を返したら注入 `sleep` で待機後1回だけ再試行（既定は実 setTimeout・既定待機 1500ms。`isImagePropagationError` で判定）。
  - dry-run 経路は不変（非書込）。
- `webui/app/api/migrate/rakuten-to-yahoo/route.ts`:
  - `syncYahooImages` を `{ ok, error?, uploaded: number[] }` に拡張（アップロード成功 index を収集して返す）。
  - deps に `buildImageUrls:(neCode,indices)=>buildYahooItemImageUrls(neCode,indices,cfg.sellerId)` を注入（A3・実 sellerId 基底）。`buildYahooItemImageUrls` を import 追加。
- `webui/lib/converters/image-url.ts`（A3）:
  - `buildYahooImageUrls` / `buildYahooItemImageUrls` を `(neCode, imageCountOrIndices: number|number[], sellerId?)` に拡張。sellerId 指定で base=`https://shopping.c.yimg.jp/lib/${sellerId}`、未指定は従来(okimarumarket)＝後方互換。index 配列で成功画像のみ構築可。`yahooLibBase`/`yahooImageUrlForIndex` ヘルパ追加。
- `webui/lib/yahoo/item-mapper.ts`（B1-B4）:
  - `validateEditItemParams` に値域ゲートを追加（shape `{ok}|{ok,missing}` 維持）— B1 price 整数1〜99,999,999 / B2 item_code `/^[A-Za-z0-9-]+$/`・99字以内 / B3 product_category `/^[0-9]{1,10}$/`。空欄は従来必須チェックが拾い、値域外を missing に surface → executor preview 経由で dry-run requires_manual へ前倒し（B4）。
- `webui/lib/migrate/executor.test.ts`（A5・Bash で是正）:
  - 副作用順序 effects 期待を `[...,"upsert","syncImage","editYahoo","recordHistory"]` へ（syncImage を editYahoo の前）。誤順序を固定していた spec の是正。**この1配列のみ変更、他ケース無改変。**

## 新規テスト（Bash 作成）
- `webui/lib/migrate/executor-image.test.ts`（7 it）— syncImage→editYahoo 順 / uploaded 駆動 item_image_urls 上書き / buildImageUrls 未注入は不変 / 全失敗→failed・editItem 不呼出 / warnings surface / it-14091 リトライ(sleep 注入) / 無関係エラーは非リトライ。
- `webui/lib/yahoo/item-mapper-validate.test.ts`（6 it）— price・item_code・product_category の正常/値域外。
- `webui/lib/converters/image-url-seller.test.ts`（5 it）— sellerId 基底反映 / 未指定の従来基底 / index 配列駆動 / 枚数指定の従来挙動不変。

## 未解決事項 / 既知リスク
- A4 の待機既定値は 1500ms（generator 裁量）。実機伝播ラグに対し1回再試行。ライブでの it-14091 最終解消確認はループ外（`e2e_migrate --commit`）。
- 「全画像失敗→failed」の判定基準は `product.image_count>=1`。image_count>=1 だが image_url_N が実在しない（転送元なし）商品は failed 扱いになる（取込3商品は image_count>=1 かつ実URLあり想定）。
- lib-path.ts の `buildYahooLibFileName.publicUrl` は従来基底のままだが、アップロードは `uploadLibImage(token, sellerId, ...)` が実 sellerId を使い、参照URLは executor が buildImageUrls(sellerId)で上書きするため不整合は生じない。

## 触っていない範囲（plan外・意図的に保留）
- `webui/lib/converters/yahoo.ts`（YahooConverter 本体）— 変更禁止。item_image_urls の動的化は executor/image-url 側で実現。
- 既存テスト（A5 を除く242）— 無改変。route 系テストは dry-run のみで commit 経路を踏まないため影響なし。
- 設定/依存/ハーネス/.env/secrets / ライブAPI・submitItem — 不変・非実行。
