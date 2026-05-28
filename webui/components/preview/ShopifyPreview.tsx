"use client";

import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";

const SHOPIFY_CDN_BASE = "https://cdn.shopify.com/s/files/1/0602/0992/2282/files/";

function baseCode(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

function priceWithTax(p: ProductInput): number {
  return Math.round(p.selling_price * (1 + p.tax_rate / 100));
}

export function ShopifyPreview({
  product,
  peers,
}: {
  product: ProductInput;
  peers: ProductInput[];
}) {
  const base = baseCode(product);
  const variants = [
    product,
    ...peers.filter((p) => baseCode(p) === base && p.ne_code !== product.ne_code),
  ].sort((a, b) => a.quantity - b.quantity);
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const current = variants.find((v) => v.ne_code === selectedNe) ?? product;

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
        {current.display_name || <span className="text-slate-400">(商品名未入力)</span>}
      </h2>

      {/* Vendor */}
      {current.maker_name && (
        <div className="text-sm text-slate-600">Vendor: {current.maker_name}</div>
      )}

      {/* バリアント */}
      {variants.length > 1 && (
        <div>
          <label className="text-sm font-semibold block mb-1">
            {current.option_item_name || "セット数を選んでください"}:
          </label>
          <select
            value={selectedNe}
            onChange={(e) => setSelectedNe(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2 w-full text-sm"
          >
            {variants.map((v) => (
              <option key={v.ne_code} value={v.ne_code}>
                {v.quantity === 1 ? `1${v.unit}` : `${v.quantity}${v.unit}セット`} (¥
                {priceWithTax(v).toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 価格 */}
      <div className="text-2xl font-bold">
        ¥{priceWithTax(current).toLocaleString()}
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

      {/* 商品説明 */}
      <div className="border-t border-slate-200 pt-4">
        <div
          className="text-sm prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{
            __html: current.description_pc || "<p class='text-slate-400'>(説明文未入力)</p>",
          }}
        />
      </div>

      {/* デバッグ情報 */}
      <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        Handle: {base} / SKU: {current.ne_code} / Barcode: {current.jan_code}
      </div>
    </div>
  );
}
