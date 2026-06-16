"use client";

import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";
import { RAKUTEN_IMAGE_BASE, buildRakutenImgList } from "@/lib/converters/image-url";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";

function baseCode(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

export function RakutenPreview({
  product,
  peers,
}: {
  product: ProductInput;
  peers: ProductInput[];
}) {
  const variants = [product, ...peers.filter((p) => p.ne_code !== product.ne_code)].sort(
    (a, b) => a.quantity - b.quantity,
  );
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const current = variants.find((v) => v.ne_code === selectedNe) ?? product;
  const base = baseCode(current);

  // 公開時と同じ画像規約 (R-Cabinet):
  //   商品画像1      = thum02/{ne_code}.jpg
  //   PC用販売説明文 = thum02/{base}_2.jpg … _N.jpg を width:100% で縦並び (imgList)
  const heroUrl = `${RAKUTEN_IMAGE_BASE}/${current.ne_code}.jpg`;
  // PC用販売説明文: 任意入力があればそれを、空なら画像から自動生成した imgList(公開時と同じ)。
  const saleDescHtml = current.sale_description_pc.trim()
    ? current.sale_description_pc
    : buildRakutenImgList(base, current.image_count || 0);
  const itemDescHtml = current.description_pc;
  // プレビュー本体 = PC用販売説明文 + PC用商品説明文。公開時と同じ生HTMLを描画する。
  const bodyHtml =
    saleDescHtml +
    (itemDescHtml ||
      (saleDescHtml ? "" : '<p style="color:#94a3b8">(画像・説明文 未入力)</p>'));

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide">楽天市場 プレビュー</div>

      {/* 商品画像メイン (商品画像1 = R-Cabinet thum02/{ne_code}.jpg) */}
      <div className="bg-slate-100 aspect-[4/3] flex items-center justify-center text-slate-400 rounded overflow-hidden">
        <img
          src={heroUrl}
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
      {current.catch_copy_pc && (
        <p className="text-sm text-red-700">{current.catch_copy_pc}</p>
      )}

      {/* 価格 (楽天赤) */}
      <div>
        <div className="text-3xl font-bold text-red-600">
          ¥{current.selling_price.toLocaleString()}
          <span className="text-xs ml-1 text-slate-500">(税抜)</span>
        </div>
      </div>

      {/* バリエーション選択 */}
      {variants.length > 1 && (
        <div className="border border-slate-200 rounded p-3 space-y-2">
          <div className="text-sm font-semibold">本数:</div>
          <div className="space-y-1">
            {variants.map((v) => (
              <label key={v.ne_code} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="rakuten-variant"
                  checked={selectedNe === v.ne_code}
                  onChange={() => setSelectedNe(v.ne_code)}
                />
                <span>{v.quantity}本</span>
                <span className="text-slate-500">¥{v.selling_price.toLocaleString()}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* カゴに入れる */}
      <button className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3 rounded font-bold">
        カゴに入れる
      </button>

      {/* 商品説明: PC用販売説明文(imgList) + PC用商品説明文 を実HTMLのまま描画 */}
      <div className="border-t border-slate-200 pt-4">
        <div className="text-sm font-semibold mb-2">─── 商品説明（販売説明文＋商品説明文）───</div>
        <HtmlPreviewFrame html={bodyHtml} title="楽天 商品説明プレビュー" />
      </div>

      {/* デバッグ情報 */}
      <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
        商品管理番号: {base} / SKU: {current.ne_code} / カタログ: {current.jan_code} / 画像 {current.image_count} 枚
      </div>
    </div>
  );
}
