"use client";

import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";
import { RAKUTEN_IMAGE_BASE, buildRakutenImgList } from "@/lib/converters/image-url";
import { buildSkuEntries } from "@/lib/preview/sku-entries";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";

function baseCode(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

/** image_url_{i}（取込した実画像URL）を取り出す。空文字なら null。 */
function imageUrlAt(p: ProductInput, i: number): string | null {
  const u = (p as unknown as Record<string, unknown>)[`image_url_${i}`];
  return typeof u === "string" && u.trim() !== "" ? u : null;
}

export function RakutenPreview({
  product,
  peers,
}: {
  product: ProductInput;
  peers: ProductInput[];
}) {
  // SKU切替リスト: 多SKU商品は variants[] を展開、フラット商品は peers から従来どおり構成。
  const entries = buildSkuEntries(product, peers);
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const cur = entries.find((e) => e.v.ne_code === selectedNe) ?? entries[0];
  const page = cur.p; // 商品ページ共通（名前・説明・画像）
  const sku = cur.v; // SKU単位（価格・コード）
  // 商品管理番号: 取込商品は実際の管理番号を優先（CSVと同じ規則）。
  const base = page.rakuten_manage_number?.trim() || baseCode(page);

  // 画像URL: 取込した実画像URL(image_url_N)があればそれを優先。無ければ公開時と同じ自動生成規約。
  //   商品画像1      = image_url_1 || thum02/{ne_code}.jpg
  //   PC用販売説明文 = image_url_2..N || thum02/{base}_2.jpg … _N.jpg を width:100% で縦並び (imgList)
  const heroUrl = imageUrlAt(page, 1) ?? `${RAKUTEN_IMAGE_BASE}/${sku.ne_code}.jpg`;
  // 取込した実画像URL(2枚目以降)があれば、それで imgList を組む。無ければ算出。
  const explicitImgList = Array.from({ length: Math.max(0, (page.image_count || 0) - 1) }, (_, k) =>
    imageUrlAt(page, k + 2),
  ).filter((u): u is string => u !== null);
  const autoImgList =
    explicitImgList.length > 0
      ? explicitImgList.map((u) => `<img src="${u}" width="100%"><br>`).join("")
      : buildRakutenImgList(base, page.image_count || 0);
  // PC用販売説明文: 任意入力があればそれを、空なら画像から組み立てた imgList(公開時と同じ)。
  const saleDescHtml = page.sale_description_pc.trim() ? page.sale_description_pc : autoImgList;
  const itemDescHtml = page.description_pc;
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
        {page.display_name || <span className="text-slate-400">(商品名未入力)</span>}
      </h2>

      {/* キャッチコピー */}
      {page.catch_copy_pc && (
        <p className="text-sm text-red-700">{page.catch_copy_pc}</p>
      )}

      {/* 価格 (楽天赤) */}
      <div>
        <div className="text-3xl font-bold text-red-600">
          ¥{sku.selling_price.toLocaleString()}
          <span className="text-xs ml-1 text-slate-500">(税抜)</span>
        </div>
      </div>

      {/* バリエーション選択 */}
      {entries.length > 1 && (
        <div className="border border-slate-200 rounded p-3 space-y-2">
          <div className="text-sm font-semibold">本数:</div>
          <div className="space-y-1">
            {entries.map((e) => (
              <label key={e.v.ne_code} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="rakuten-variant"
                  checked={cur.v.ne_code === e.v.ne_code}
                  onChange={() => setSelectedNe(e.v.ne_code)}
                />
                <span>{e.v.variation_value || `${e.v.quantity}本`}</span>
                <span className="text-slate-500">¥{e.v.selling_price.toLocaleString()}</span>
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
        商品管理番号: {base} / SKU: {sku.ne_code} / カタログ: {sku.jan_code} / 画像 {page.image_count} 枚
      </div>
    </div>
  );
}
