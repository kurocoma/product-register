"use client";

import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";
import { SHOPIFY_CDN_BASE, buildShopifyBodyHtml, priceWithTax } from "@/lib/converters/shopify";
import { buildSkuEntries, type SkuEntry } from "@/lib/preview/sku-entries";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";
import { ImageCarousel, ImageWithFallback } from "./parts";
import type { PreviewDevice } from "./PreviewTabs";

function baseCode(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

/** 実ページのバリアント選択肢と同じ表記（CSV/API の Option1 Value 規約に一致）:
 * variation_value（送料無料 SKU は "(送料無料)" 接尾辞）。フラット商品は数量+単位で合成。
 * 実ページの選択肢に価格は表示されない。 */
function optionLabel(e: SkuEntry): string {
  const label =
    e.v.variation_value ||
    (e.v.quantity === 1 ? `1${e.p.unit}` : `${e.v.quantity}${e.p.unit}セット`);
  return e.v.shipping_type === "送料無料" ? `${label}(送料無料)` : label;
}

// 実ページ実測の色（shop.kurima.co.jp / Corekara-theme）: 購入ボタンの青・お気に入りの水色
const SHOPIFY_BLUE = "#0059a6";
const WISHLIST_BLUE = "#4fa5c6";

/** 実ページ構成（shop.kurima.co.jp/products/n019-0328 を PC 1280px / iPhone 390px で実測・
 * 2026-07-08・テーマ Corekara-theme 1.9.0）に合わせた Shopify プレビュー。
 * - PC:  商品ブロック2カラム（左=メイン画像＋サムネイル4列グリッド / 右=商品名→価格(赤・税込)→
 *        販売元→商品コード→配送料注記→バリアント→個数→カートに追加する→今すぐ購入→
 *        別のお支払い方法→お気に入り→シェア行）→ 下段全幅に Body(HTML) 説明文
 * - スマホ: 画像カルーセル → 同順の1カラム（別のお支払い方法リンクは非表示）
 * 画像・価格・説明文は登録 CSV/API と同じ規約（SHOPIFY_CDN_BASE・priceWithTax・
 * buildShopifyBodyHtml・Vendor="maker_name<br>商品コード:base"）から描画する（創作しない）。
 * ヘッダー・サイドバー・パンくず・「あなたへおすすめの商品」等の店舗共通 chrome は対象外。 */
export function ShopifyPreview({
  product,
  peers,
  device = "pc",
}: {
  product: ProductInput;
  peers: ProductInput[];
  device?: PreviewDevice;
}) {
  const base = baseCode(product);
  // SKU切替リスト: 多SKU商品は variants[] を展開、フラット商品は同一 base の peers から従来どおり構成。
  const entries = buildSkuEntries(product, peers, {
    peerFilter: (p) => baseCode(p) === base,
  });
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const cur = entries.find((e) => e.v.ne_code === selectedNe) ?? entries[0];

  // ギャラリー: 商品画像（登録 CSV の Image Src 規約: 1枚目 {base}-1.jpg / 以降 {base}_{n}.jpg）
  // + SKU 画像（Variant Image 規約: {ne_code}.jpg）。実ページのサムネイル一覧と同じ並び。
  const imageCount = Math.max(0, cur.p.image_count || 0);
  const productImages = Array.from({ length: imageCount }, (_, k) =>
    k === 0 ? `${SHOPIFY_CDN_BASE}${base}-1.jpg` : `${SHOPIFY_CDN_BASE}${base}_${k + 1}.jpg`,
  );
  const variantImages = entries.map((e) => `${SHOPIFY_CDN_BASE}${e.v.ne_code}.jpg`);
  const gallery = [...productImages, ...variantImages];

  // Body(HTML) = Shopify imgList(店舗CDN画像) + 商品説明文。公開時と同じHTMLを描画する。
  const hasContent = !!cur.p.description_pc || imageCount > 1;
  const bodyHtml = hasContent
    ? buildShopifyBodyHtml(base, imageCount, cur.p.description_pc)
    : '<p style="color:#94a3b8">(画像・説明文 未入力)</p>';

  // バリアント選択: 実ページはラベル「セット数を選んでください」（登録時の Option1 Name と同じ固定文言）
  // + select。選択肢は Option1 Value と同表記（価格なし・送料無料接尾辞）。
  const variantSelector = entries.length > 1 && (
    <div>
      <label className="text-xs text-slate-700 block mb-1">セット数を選んでください</label>
      <select
        value={cur.v.ne_code}
        onChange={(e) => setSelectedNe(e.target.value)}
        className={`border border-slate-300 rounded-sm px-3 py-2 text-sm bg-white ${
          device === "sp" ? "w-full" : "w-full max-w-[220px]"
        }`}
      >
        {entries.map((e) => (
          <option key={e.v.ne_code} value={e.v.ne_code}>
            {optionLabel(e)}
          </option>
        ))}
      </select>
    </div>
  );

  // 商品情報カラム（実ページの表示順: 商品名→価格→販売元→商品コード→配送料注記→バリアント→個数→ボタン群）
  const infoColumn = (
    <div className="space-y-3">
      <h2 className={`font-bold leading-snug ${device === "sp" ? "text-xl" : "text-2xl"}`}>
        {cur.p.display_name || <span className="text-slate-400">(商品名未入力)</span>}
      </h2>

      {/* 価格: 実ページは赤字「¥N,NNN（税込）」。登録時と同じ税込換算（Variant Price = priceWithTax） */}
      <div className="text-2xl font-bold text-red-600">
        ¥{priceWithTax(cur.v).toLocaleString()}
        <span className="text-sm ml-1">（税込）</span>
      </div>

      {/* 販売元(Vendor): 登録時の Vendor 列 "{maker_name}<br>商品コード:{base}" と同じ2行 */}
      <div className="text-sm text-slate-700 space-y-0.5">
        {cur.p.maker_name && <div>{cur.p.maker_name}</div>}
        <div>商品コード:{base}</div>
      </div>

      {/* 配送料注記（Shopify 標準文言・全商品共通）。店舗テーマ独自の送料テキストは店舗設定由来のため
          プレビュー対象外（assist-plan 質問リスト参照） */}
      <div className="text-xs text-slate-500">
        <span className="underline">配送料</span>は購入手続き時に計算されます。
      </div>

      {variantSelector}

      {/* 個数（実ページ: ラベル+入力欄。プレビュー用の見た目のみ） */}
      <div>
        <div className="text-xs text-slate-700 mb-1">個数</div>
        <div className="border border-slate-300 rounded-sm w-16 px-3 py-2 text-sm bg-white">1</div>
      </div>

      {/* 購入ボタン群（実測: 白地青枠「カートに追加する」/ 青塗りウォレット枠「今すぐ購入」/
          PC のみ「別のお支払い方法」リンク / 水色「お気に入りに追加」） */}
      <div className="space-y-2">
        <button
          className="w-full bg-white py-3 rounded-sm font-medium text-lg border"
          style={{ borderColor: SHOPIFY_BLUE, color: SHOPIFY_BLUE }}
        >
          カートに追加する
        </button>
        <button
          className="w-full py-3 rounded-sm font-medium text-white"
          style={{ backgroundColor: SHOPIFY_BLUE }}
        >
          今すぐ購入
        </button>
        {device !== "sp" && (
          <div className="text-center text-xs text-slate-600 underline">別のお支払い方法</div>
        )}
        <button
          className="w-full py-2.5 rounded-sm text-sm text-white"
          style={{ backgroundColor: WISHLIST_BLUE }}
        >
          ♡ お気に入りに追加
        </button>
      </div>

      {/* シェア行（店舗テーマの共通 chrome・実測文言） */}
      <div className="flex gap-2 text-xs text-slate-600">
        <span className="border border-slate-200 rounded px-2 py-1">シェア</span>
        <span className="border border-slate-200 rounded px-2 py-1">ツイート</span>
        <span className="border border-slate-200 rounded px-2 py-1">LINEで送る</span>
      </div>
    </div>
  );

  // 商品説明: 実ページは商品ブロックの下に見出しなし・全幅で Body(HTML) が入る。iframe で忠実描画。
  const descriptionBlock = (
    <div className="border-t border-slate-200 pt-4">
      <div className="text-sm font-semibold mb-2">─── 商品説明 Body(HTML)（実ページ: 商品ブロック下・全幅）───</div>
      <HtmlPreviewFrame html={bodyHtml} title="Shopify 商品説明プレビュー" />
    </div>
  );

  const debugFooter = (
    <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
      Handle: {base} / SKU: {cur.v.ne_code} / Barcode: {cur.v.jan_code} / 画像 {imageCount} 枚
    </div>
  );

  if (device === "sp") {
    // ── スマホ実ページの並び: 画像カルーセル → 商品情報1カラム → 説明文 ──
    return (
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">
          Shopify ストアフロント プレビュー（スマホ）
        </div>
        <div className="max-w-[390px] mx-auto space-y-4">
          <ImageCarousel images={gallery} />
          {infoColumn}
          {descriptionBlock}
          {debugFooter}
        </div>
      </div>
    );
  }

  // ── PC 実ページの並び: 商品ブロック2カラム（左=画像 / 右=情報・購入） → 下段全幅に説明文 ──
  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide">
        Shopify ストアフロント プレビュー（PC）
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="bg-slate-100 aspect-square flex items-center justify-center text-slate-400 rounded overflow-hidden">
            <ImageWithFallback src={gallery[0]} />
          </div>
          {/* サムネイル一覧（実ページ: メイン下に4列グリッド・商品画像+SKU画像） */}
          {gallery.length > 1 && (
            <div className="grid grid-cols-4 gap-1">
              {gallery.map((u, i) => (
                <div
                  key={u}
                  className="bg-slate-100 aspect-square rounded overflow-hidden flex items-center justify-center text-[10px] text-slate-400"
                >
                  <ImageWithFallback src={u} label={`${i + 1}`} />
                </div>
              ))}
            </div>
          )}
        </div>
        {infoColumn}
      </div>

      {descriptionBlock}
      {debugFooter}
    </div>
  );
}
