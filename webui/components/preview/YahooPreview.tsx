"use client";

import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";
import { YAHOO_IMAGE_BASE, buildYahooImgListHtml } from "@/lib/converters/image-url";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";

function priceInclusive(p: ProductInput): number {
  return Math.floor(p.selling_price * (1 + p.tax_rate / 100) + 0.5);
}

function variationName(p: ProductInput): string {
  return p.quantity === 1 ? `1${p.unit}` : `${p.quantity}${p.unit}セット`;
}

export function YahooPreview({
  product,
  peers,
}: {
  product: ProductInput;
  peers: ProductInput[];
}) {
  const grouped = product.yahoo_grouping_enabled;
  const variants = grouped
    ? [product, ...peers.filter((p) => p.yahoo_grouping_enabled && p.ne_code !== product.ne_code)].sort(
        (a, b) => a.quantity - b.quantity,
      )
    : [product];
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const current = variants.find((v) => v.ne_code === selectedNe) ?? product;

  // caption(商品説明) = Yahoo imgList(店舗ライブラリ画像) + 商品説明文。公開時と同じHTMLを描画する。
  const captionImgList = buildYahooImgListHtml(current.ne_code, current.image_count || 0);
  const bodyHtml =
    captionImgList +
    (current.description_pc ||
      (captionImgList ? "" : '<p style="color:#94a3b8">(画像・説明文 未入力)</p>'));

  const prices = variants.map(priceInclusive);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide">Yahoo!ショッピング プレビュー</div>

      {/* 商品画像 */}
      <div className="bg-slate-100 aspect-[4/3] flex items-center justify-center text-slate-400 rounded overflow-hidden">
        <img
          src={`${YAHOO_IMAGE_BASE}/${current.ne_code}.jpg`}
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
      <h2 className="text-base font-bold leading-snug">
        {current.display_name || <span className="text-slate-400">(商品名未入力)</span>}
      </h2>

      {/* キャッチコピー */}
      {current.catch_copy_yahoo && (
        <p className="text-sm text-red-700">{current.catch_copy_yahoo}</p>
      )}

      {/* 価格 */}
      <div className="text-3xl font-bold text-red-600">
        ¥{minPrice.toLocaleString()}
        {minPrice !== maxPrice && ` 〜 ¥${maxPrice.toLocaleString()}`}
        <span className="text-xs ml-1 text-slate-500">(税込)</span>
      </div>

      {/* grouping セレクタ */}
      {grouped && variants.length > 1 && (
        <div className="border border-slate-200 rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">{current.yahoo_variation_title || "数量"}:</div>
            <div className="text-xs text-orange-700 bg-orange-50 px-2 py-0.5 rounded">
              grouping-id で集約
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const active = v.ne_code === selectedNe;
              return (
                <button
                  key={v.ne_code}
                  type="button"
                  onClick={() => setSelectedNe(v.ne_code)}
                  className={`px-3 py-2 border rounded text-sm transition-colors ${
                    active
                      ? "bg-red-50 border-red-500 text-red-700"
                      : "border-slate-300 hover:border-slate-400"
                  }`}
                >
                  <div className="font-semibold">{variationName(v)}</div>
                  <div className="text-xs">¥{priceInclusive(v).toLocaleString()}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* カートに入れる */}
      <button className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded font-bold">
        カートに入れる
      </button>

      {/* 商品説明: caption(imgList + 商品説明文) を実HTMLのまま iframe で忠実描画 */}
      <div className="border-t border-slate-200 pt-4">
        <div className="text-sm font-semibold mb-2">─── 商品説明 (caption) ───</div>
        <HtmlPreviewFrame html={bodyHtml} title="Yahoo 商品説明プレビュー" />
      </div>

      {/* デバッグ情報 */}
      <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        code: {current.ne_code}
        {grouped && ` / grouping-id: ${current.ne_code.replace(/-\d+$/, "")}`}
      </div>
    </div>
  );
}
