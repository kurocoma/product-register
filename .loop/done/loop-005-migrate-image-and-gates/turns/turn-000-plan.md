# turn-000 plan（loop-005 Bundle A+B）

## Goal
監査の Bundle A(it-14091 本解消)＋Bundle B(値域ゲート)を実装。優先核 = **A1(順序是正)+A3(lib基底URL動的化)+A5(テスト是正)+B1-B4(値域ゲート)**＝ライブ it-14091 解消と103件耐性。A2(画像ゲート/warnings)+A4(リトライ)は堅牢化。**既存テストは A5 の順序期待値是正のみ変更し、他243は緑を維持**（最優先制約）。

## Analysis（実コード接地・監査 evidence）
- executor.ts commit: 9a upsert → 9b editYahoo(184-206) → 9c syncImage(208-217)。**editItem が先**で item_image_urls(yahoo.ts:75,103 → image-url.ts:47-57 基底 okimarumarket)を参照するが画像 lib upload(route.ts:209-251)は後段 → it-14091。
- upload は getYahooConfig().sellerId(auth.ts:19)で lib/{sellerId}/。基底 okimarumarket と不一致なら reorder でも残る。
- syncImage dep: 現状 `(productId, product) => Promise<{ok, error?}>`（executor.ts:51-52）。route の実体 syncYahooImages(route.ts:184-226) は product の image_url_N を i=1..count で upload。
- validateEditItemParams(item-mapper.ts:158-187): 必須有無＋文字数のみ。price `"0"` を truthy 合格。item_code/product_category の書式未検証。
- executor.test.ts:131-138: effects 期待 [...,'editYahoo','syncImage',...]（誤順序を固定）。

## Changes
### A1+A2+A3+A4 commit 経路の画像処理（executor.ts + route.ts + image-url.ts + item-mapper.ts）
- **syncImage dep の戻り値拡張（後方互換）**: `{ ok: boolean; error?: string; uploaded?: number[] }`（uploaded=アップロード成功した画像 index 群）。既存 fake が `{ok:true}` を返す場合(uploaded 未指定)は従来挙動にフォールバック（既存 executor.test を壊さない）。route の syncYahooImages を「成功 index を集めて返す」よう修正。
- **executor.ts commit 順を是正(A1)**: upsert(9a) の直後に **syncImage(9c→9bの前)** を実行。`item_image_urls` を **uploaded index 駆動**で再構築(A2)してから editItem。新 dep `buildImageUrls?(neCode, indices)`(route が sellerId 注入)で sellerId 基底URLを生成(A3)し、`editParams.item_image_urls` を上書き。`buildImageUrls` 未注入(既存fake)なら editParams のまま（後方互換）。
- **全画像失敗の扱い(A2)**: アップロード対象があったのに uploaded が空 → editItem に進まず status=failed（壊れURLで it-14091 再発させない）。画像0枚(対象なし)は item_image_urls を送らない。
- **warnings surface(A2)**: `edit.warnings` を MigrationItemResult(error/note)へ surface。
- **A4 リトライ**: editYahoo が it-14091/im-02005 を返したら、注入 `sleep` で短い待機後1回だけ再試行（sleep 既定は実 sleep・テストは no-op 注入）。Yahoo API スロットルは route 側 or executor 側で最小限。
- **image-url.ts(A3)**: `buildYahooItemImageUrls(neCode, imageCountOrIndices, sellerId?)` を sellerId 対応に（sellerId 指定時 base=`https://shopping.c.yimg.jp/lib/${sellerId}`、未指定は従来＝後方互換）。okimarumarket は既定フォールバックに留め、route 経路では sellerId を渡す。
- **route.ts**: deps に `buildImageUrls:(neCode,indices)=>buildYahooItemImageUrls(neCode,indices,cfg.sellerId)` を注入。syncYahooImages は uploaded index を返す。

### A5 executor.test.ts の順序是正（Bash 編集・誤spec修正）
- executor.test.ts:131-138 の effects 期待を **syncImage を editYahoo の前**へ修正（[...,'upsert','syncImage','editYahoo',...]）。DEC-503 のとおり報酬ハッキングでなく誤順序の是正。**この1テストのみ**変更し、他の executor.test ケース・他テストは無改変で緑を維持。dep 拡張は後方互換にして既存 fake が通るようにする。

### B1-B4 値域ゲート（item-mapper.ts validateEditItemParams）
- 既存の必須有無＋文字数チェックに追加（shape {ok}|{ok,missing} 維持）:
  - **B1 price**: 数値化して 1〜99,999,999 外(0/非数値含む)なら missing に `price 範囲外`。
  - **B2 item_code**: `/^[A-Za-z0-9-]+$/` 不一致 or 99字超なら missing。
  - **B3 product_category**: `/^[0-9]{1,10}$/` 不一致なら missing。
- **B4**: executor の preview は injected validateYahoo(=validateEditItemParams)を呼ぶ(executor.ts:144)ので、上記違反は missingRequiredYahooFields→buildItemPlan→requires_manual に自動で倒れる（dry-run surface）。

## 新規テスト（Bash 作成・A5 以外の既存 *.test.* は無改変）
- `webui/lib/migrate/executor-image.test.ts`: commit で syncImage が editYahoo の前 / uploaded index 駆動で item_image_urls 構築 / 全失敗→failed / warnings surface / editItem it-14091→sleep注入で1回リトライ。
- `webui/lib/yahoo/item-mapper-validate.test.ts`: price 0/範囲外/非数値→ok:false、item_code `_`/長→ok:false、product_category 非数値/11桁→ok:false、正常→ok。
- `webui/lib/converters/image-url.test.ts` があれば**新規別ファイル** `image-url-seller.test.ts`: sellerId 指定で base 反映 / 未指定で従来。

## Pre-submission checks
- `cd webui`: `npx tsc --noEmit`/`npm run lint`/`npm run test`(既存243は A5 の順序是正のみ変更で緑＋新規)/`npm run build` 全0。

## 優先（generator 向け）
A1+A3+A5+B1-B4（ライブ解消＋103耐性の核）→ A2(画像ゲート/warnings)→ A4(リトライ)。dep 拡張は**後方互換**にして既存 executor.test を壊さない。尽きそうなら核を確保し4ゲート緑、A2/A4 未完は report に明記。
