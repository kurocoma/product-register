# 多SKU(variants[])対応 設計書

> 作成: 2026-06-26 / 商品登録アプリ(webui) / Next.js + Supabase

## 目的
楽天の1商品ページ(管理番号)に複数SKU(単品・セット・本数違い等)がぶら下がるケースで、**SKUごとに販売価格・配送設定を持ち、まとめて編集・反映**できるようにする。現状は「1商品=1SKU(フラットフィールド)」。

## ユーザー要望(出典)
- #1 SKU管理番号ごとに売価設定(単品・セットを一緒に価格改定したい)
- #3 SKU管理番号ごとに配送設定(送料/送料区分/配送方法セット/置き配/個別送料 — Image #8 の楽天SKU別配送画面)
- 採用方式: **product レコードに `variants[]` を内包**(ユーザー選択)。グループキーは **楽天商品管理番号(ページ)**。

## モデル
`ProductInput` を「商品ページ共通項目」＋「SKU配列 `variants[]`」に再構成。**後方互換**: variants 未設定/長さ1 は現行の単品と等価。

### 商品ページ共通(product-level、全SKU共有)
display_name, product_name, description_pc/sp, catch_copy_*, image_url_*/image_count,
mall_category_id, yahoo_category_id, yahoo_path, maker_code, rakuten_manage_number(ページ=グループキー)

### SKU単位(variant-level)
- `sku_manage_number` (楽天 variant キー = SKU管理番号。現 `rakuten_variant_id`)
- `ne_code` (各SKUのNEコード = システム連携用SKU番号 merchantDefinedSkuId)
- `jan_code`
- `selling_price`
- `tax_rate`
- `quantity` (本数。バリエーション選択肢の素)
- `variation_value` (バリエーション項目選択肢ラベル。例 "1本"/"詰替セット")
- 配送(#3): `shipping_type`(送料別/無料=postageIncluded), `postage_segment_1/2`(送料区分1/2=postageSegment.local/overseas), `shipping_method_group`(配送方法セットID=shippingMethodGroup), `individual_shipping_fee`(個別送料=fee), `okihai`(置き配可否)
- `attributes[]` (ジャンル必須属性。論理は共通だが楽天APIは variant配下。共通入力→全variantへ複製でも可)

楽天 variant.shipping の正式キー(docs/楽天/04): `postageIncluded`(bool), `fee`(個別送料), `postageSegment.local/overseas`(送料区分1/2), `shippingMethodGroup`(配送方法セット), `singleItemShipping`(単品配送設定)。**排他**: postageIncluded=true なら fee/postageSegment 不可。

## 後方互換戦略(最重要・回帰防止)
- `variants[]` は**追加フィールド**。既存フラット(selling_price/jan_code/ne_code/shipping_type/rakuten_variant_id)は当面**残す＝variants[0]のミラー**。
- ヘルパ `productVariants(p): Variant[]` = `p.variants?.length ? p.variants : [単一variantをフラットから合成]`。全消費側はこのヘルパ経由に段階移行。
- 各層を1つずつ variants[] 対応に切替え、**切替えごとに既存テスト(vitest/CSV/register/import/patch e2e)が緑のまま**を確認。フラット撤去は全消費側移行後の最終段。

## Yahoo方針
Yahooは variant 概念が異なる(item単位 + subcode_param で SKU別price、2025+)。本対応は**楽天を主対象**。Yahooは「variants[0](代表)で従来通り」+ 将来 subcode_param で拡張(別タスク)。

## 段階計画(各段で緑維持・コミット)
- **P1 基盤**: schema に `variants[]`(+Variant型)。repository は extra(JSON)に保存・復元。`productVariants` ヘルパ。**消費側は未変更**=既存フロー無傷。ユニットテスト追加。
- **P2 取込**: `parseRakutenItem` を全variant返却に拡張(or 新関数)。`/api/import/rakuten` が**ページの全SKUを variants[] に取込み**1商品生成(管理番号でグループ)。flat=variants[0]。e2e。
- **P3 編集UI**: ProductForm/ProductEditView に「SKU一覧」表(各SKUの販売価格・JAN・配送を inline 編集)。product共通項目は上部。保存で variants[] 永続。
- **P4 配送詳細(#3)**: Variant に配送詳細フィールド + UI入力 + 楽天 variant.shipping へマッピング。
- **P5 反映/CSV/プレビュー**: `buildRakutenUpsertBody`/patch を**variants[]全件→多variant body**化(items.patchは複数variant同時更新可)。CSV(楽天/Shopify親子・Yahoo)とプレビューを peers→`productVariants` に移行。MallEditPanel を多SKU一括反映に。
- **P6 後片付け**: peers依存の撤去、フラットの整理(消費側完全移行後)。

## 受け入れ
- `n050-3419-1` ページ取込 → 単品 `n050-3419-1` と セット `n050-3419-s01` が1商品の variants[] に入る。
- 編集画面でSKUごとに販売価格・配送を変更 → 楽天へ一括反映(items.patch 多variant) → 両SKUの価格・配送が更新。
- 既存の単品商品(variants未設定)は従来どおり登録/編集/CSV/プレビューが動作(回帰なし)。

## 非対象(YAGNI)
- Yahoo の subcode_param 多SKU(将来)。Amazon。バリエーション軸の複雑構成(色×サイズ等の多軸)は単軸(本数/種別)優先。
