"use client";

import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";
import { buildYahooImageUrls, buildYahooImgListHtml } from "@/lib/converters/image-url";
import { buildRepresentativeEntries, type SkuEntry } from "@/lib/preview/sku-entries";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";
import { ImageCarousel, ImageWithFallback, QuantityRow } from "./parts";
import type { PreviewDevice } from "./PreviewTabs";

/** 実ページの価格表示は税込。selling_price は全モール税抜統一（Yahoo 取込時も税抜へ変換して保存）のため、
 * 新規登録・取込・編集のどの経路の商品でもこの税込換算が正しい（登録 API 送信値とも一致する）。
 * 税率は SKU の各エントリが属する商品レベル(e.p.tax_rate)を使う（variant側は古い値が残ることがある。260715修正）。 */
function priceInclusive(e: SkuEntry): number {
  return Math.floor(e.v.selling_price * (1 + e.p.tax_rate / 100) + 0.5);
}

function variationName(e: SkuEntry): string {
  return e.v.quantity === 1 ? `1${e.p.unit}` : `${e.v.quantity}${e.p.unit}セット`;
}

/** 実ページ構成（store.shopping.yahoo.co.jp/okimarumarket/* を PC 1280px / iPhone 390px で実測）に
 * 合わせた Yahoo プレビュー。
 * - PC:  2カラム（左=商品画像＋サムネイル横列 / 右=商品名→キャッチ→価格→数量→カートに入れる）
 * - スマホ: 画像カルーセル → 商品名 → キャッチ → 価格 → カートに入れる
 * 価格表記は実ページと同じ「N円＋送料無料（全国一律）」、カートボタンはオレンジ。
 * 画像・説明文は実アップロード先（店舗ライブラリ）と登録 API と同じデータから描画する。 */
export function YahooPreview({
  product,
  peers,
  device = "pc",
}: {
  product: ProductInput;
  peers: ProductInput[];
  device?: PreviewDevice;
}) {
  const grouped = product.yahoo_grouping_enabled;
  // Yahoo は掲載単位=商品（多SKUは variants[0] 代表・subcode_param は将来対応）。
  // grouping 有効時のみ peers の grouping 商品を束ねて表示する。
  const entries = grouped
    ? buildRepresentativeEntries(product, peers, {
        peerFilter: (p) => p.yahoo_grouping_enabled,
      })
    : buildRepresentativeEntries(product, []);
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const cur = entries.find((e) => e.v.ne_code === selectedNe) ?? entries[0];

  // 商品画像 1..N（店舗ライブラリの公開URL規約 = 登録時 item-image-urls と同じ並び）
  const images = buildYahooImageUrls(cur.v.ne_code, Math.max(0, cur.p.image_count || 0));

  // caption(商品説明) = Yahoo imgList(店舗ライブラリ画像) + 商品説明文。公開時と同じHTMLを描画する。
  const captionImgList = buildYahooImgListHtml(cur.v.ne_code, cur.p.image_count || 0);
  const bodyHtml =
    captionImgList +
    (cur.p.description_pc ||
      (captionImgList ? "" : '<p style="color:#94a3b8">(画像・説明文 未入力)</p>'));

  const prices = entries.map((e) => priceInclusive(e));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const nameBlock = (
    <h2 className="text-base font-bold leading-snug">
      {cur.p.display_name || <span className="text-slate-400">(商品名未入力)</span>}
    </h2>
  );
  const catchBlock = cur.p.catch_copy_yahoo && (
    <p className="text-sm text-slate-500">{cur.p.catch_copy_yahoo}</p>
  );

  // 実ページの価格表記: 「価格」見出し + N円（赤） + 送料無料（全国一律）
  const priceBlock = (
    <div className="space-y-1">
      <div className="text-sm font-semibold">価格</div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-3xl font-bold text-red-600">
          {minPrice.toLocaleString()}
          <span className="text-lg">円</span>
          {minPrice !== maxPrice && (
            <span className="text-xl"> 〜 {maxPrice.toLocaleString()}円</span>
          )}
        </span>
        {cur.v.shipping_type === "送料無料" && (
          <span className="text-sm font-bold text-red-600">送料無料（全国一律）</span>
        )}
        <span className="text-xs text-slate-400">(税込)</span>
      </div>
    </div>
  );

  // grouping セレクタ
  const groupingSelector = grouped && entries.length > 1 && (
    <div className="border border-slate-200 rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{cur.p.yahoo_variation_title || "数量"}:</div>
        <div className="text-xs text-orange-700 bg-orange-50 px-2 py-0.5 rounded">
          grouping-id で集約
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {entries.map((e) => {
          const active = e.v.ne_code === cur.v.ne_code;
          return (
            <button
              key={e.v.ne_code}
              type="button"
              onClick={() => setSelectedNe(e.v.ne_code)}
              className={`px-3 py-2 border rounded text-sm transition-colors ${
                active
                  ? "bg-red-50 border-red-500 text-red-700"
                  : "border-slate-300 hover:border-slate-400"
              }`}
            >
              <div className="font-semibold">{variationName(e)}</div>
              <div className="text-xs">{priceInclusive(e).toLocaleString()}円</div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // 実ページのカートボタン（オレンジ・「カートに入れる」）
  const cartButton = (
    <button className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3 rounded font-bold">
      カートに入れる
    </button>
  );

  const captionBlock = (
    <div className="border-t border-slate-200 pt-4">
      <div className="text-sm font-semibold mb-2">─── 商品説明 (caption) ───</div>
      <HtmlPreviewFrame html={bodyHtml} title="Yahoo 商品説明プレビュー" />
    </div>
  );

  const debugFooter = (
    <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
      code: {cur.v.ne_code}
      {grouped && ` / grouping-id: ${cur.v.ne_code.replace(/-\d+$/, "")}`}
    </div>
  );

  if (device === "sp") {
    // ── スマホ実ページの並び: カルーセル → 商品名 → キャッチ → 価格 → カートに入れる → 商品説明 ──
    return (
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">
          Yahoo!ショッピング プレビュー（スマホ）
        </div>
        <div className="max-w-[390px] mx-auto space-y-4">
          <ImageCarousel images={images} />
          {nameBlock}
          {catchBlock}
          {priceBlock}
          {groupingSelector}
          {cartButton}
          {captionBlock}
          {debugFooter}
        </div>
      </div>
    );
  }

  // ── PC 実ページの並び: 2カラム（左=メイン画像＋サムネイル横列 / 右=商品情報・購入） → 商品説明 ──
  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide">
        Yahoo!ショッピング プレビュー（PC）
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="bg-slate-100 aspect-square flex items-center justify-center text-slate-400 rounded overflow-hidden">
            <ImageWithFallback src={images[0]} />
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-1">
              {images.slice(1).map((u, i) => (
                <div key={u} className="bg-slate-100 aspect-square rounded overflow-hidden flex items-center justify-center text-[10px] text-slate-400">
                  <ImageWithFallback src={u} label={`${i + 2}`} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          {nameBlock}
          {catchBlock}
          {priceBlock}
          {groupingSelector}
          <QuantityRow />
          {cartButton}
        </div>
      </div>

      {captionBlock}
      {debugFooter}
    </div>
  );
}
