"use client";

import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";
import { SHOPIFY_CDN_BASE, buildShopifyBodyHtml } from "@/lib/converters/shopify";
import { buildSkuEntries, type SkuEntry } from "@/lib/preview/sku-entries";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";

function baseCode(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

function priceWithTax(v: { selling_price: number; tax_rate: number }): number {
  return Math.round(v.selling_price * (1 + v.tax_rate / 100));
}

function optionLabel(e: SkuEntry): string {
  if (e.v.variation_value) return e.v.variation_value;
  return e.v.quantity === 1 ? `1${e.p.unit}` : `${e.v.quantity}${e.p.unit}セット`;
}

export function ShopifyPreview({
  product,
  peers,
}: {
  product: ProductInput;
  peers: ProductInput[];
}) {
  const base = baseCode(product);
  // SKU切替リスト: 多SKU商品は variants[] を展開、フラット商品は同一 base の peers から従来どおり構成。
  const entries = buildSkuEntries(product, peers, {
    peerFilter: (p) => baseCode(p) === base,
  });
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const cur = entries.find((e) => e.v.ne_code === selectedNe) ?? entries[0];

  // Body(HTML) = Shopify imgList(店舗CDN画像) + 商品説明文。公開時と同じHTMLを描画する。
  const hasContent = !!cur.p.description_pc || (cur.p.image_count || 0) > 1;
  const bodyHtml = hasContent
    ? buildShopifyBodyHtml(base, cur.p.image_count || 0, cur.p.description_pc)
    : '<p style="color:#94a3b8">(画像・説明文 未入力)</p>';

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide">Shopify ストアフロント プレビュー</div>

      {/* 商品画像 */}
      <div className="bg-slate-100 aspect-[4/3] flex items-center justify-center text-slate-400 rounded overflow-hidden">
        <img
          src={`${SHOPIFY_CDN_BASE}${base}-1.jpg`}
          alt=""
          className="max-h-full max-w-full object-contain"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            const parent = e.currentTarget.parentElement;
            if (parent) parent.textContent = "(画像 未アップロード)";
          }}
        />
      </div>

      {/* 商品名 */}
      <h2 className="text-xl font-bold leading-snug">
        {cur.p.display_name || <span className="text-slate-400">(商品名未入力)</span>}
      </h2>

      {/* Vendor */}
      {cur.p.maker_name && (
        <div className="text-sm text-slate-600">Vendor: {cur.p.maker_name}</div>
      )}

      {/* バリアント */}
      {entries.length > 1 && (
        <div>
          <label className="text-sm font-semibold block mb-1">
            {cur.p.option_item_name || "セット数を選んでください"}:
          </label>
          <select
            value={cur.v.ne_code}
            onChange={(e) => setSelectedNe(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 w-full text-sm"
          >
            {entries.map((e) => (
              <option key={e.v.ne_code} value={e.v.ne_code}>
                {optionLabel(e)} (¥{priceWithTax(e.v).toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 価格 */}
      <div className="text-2xl font-bold">
        ¥{priceWithTax(cur.v).toLocaleString()}
        <span className="text-sm font-normal text-slate-500 ml-1">(税込)</span>
      </div>

      {/* マーケットバッジ */}
      <div className="flex gap-2 text-xs">
        <span className="bg-green-100 text-green-800 px-2 py-1 rounded">🇯🇵 日本</span>
        <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">🌐 国際</span>
      </div>

      {/* カートに追加 */}
      <button className="w-full bg-green-700 hover:bg-green-800 text-white py-3 rounded font-bold">
        カートに追加
      </button>

      {/* 商品説明: Body(HTML) (imgList + 商品説明文) を実HTMLのまま iframe で忠実描画 */}
      <div className="border-t border-slate-200 pt-4">
        <div className="text-sm font-semibold mb-2">─── 商品説明 (Body HTML) ───</div>
        <HtmlPreviewFrame html={bodyHtml} title="Shopify 商品説明プレビュー" />
      </div>

      {/* デバッグ情報 */}
      <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        Handle: {base} / SKU: {cur.v.ne_code} / Barcode: {cur.v.jan_code}
      </div>
    </div>
  );
}
