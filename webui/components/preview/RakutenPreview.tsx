"use client";

import { useState } from "react";
import type { ProductInput } from "@/lib/product/schema";
import { RAKUTEN_IMAGE_BASE, buildRakutenImgList } from "@/lib/converters/image-url";
import { buildSkuEntries } from "@/lib/preview/sku-entries";
import { HtmlPreviewFrame } from "./HtmlPreviewFrame";
import { ImageCarousel, ImageWithFallback, QuantityRow } from "./parts";
import type { PreviewDevice } from "./PreviewTabs";

function baseCode(p: ProductInput): string {
  return `${p.maker_code}-${p.jan_code.slice(-4)}`;
}

/** image_url_{i}（取込した実画像URL）を取り出す。空文字なら null。 */
function imageUrlAt(p: ProductInput, i: number): string | null {
  const u = (p as unknown as Record<string, unknown>)[`image_url_${i}`];
  return typeof u === "string" && u.trim() !== "" ? u : null;
}

/** 実ページ構成（item.rakuten.co.jp/ichiban-okinawa/* を PC 1280px / iPhone 390px で実測）に
 * 合わせた楽天プレビュー。
 * - PC:  販売説明文(imgList) → 商品ブロック2カラム（左=商品画像＋サムネイル /
 *        右=キャッチコピー→商品名→商品番号→価格→数量→かごに追加→商品説明文(PC)）
 * - スマホ: 画像カルーセル → 商品名 → キャッチコピー → 価格 → 数量 → かごに追加
 *        → 商品説明（登録時と同じ productDescription.sp = imgList + スマホ用商品説明文）
 * 画像・説明文・価格はすべて実アップロード先/登録 API と同じデータから描画する（創作しない）。 */
export function RakutenPreview({
  product,
  peers,
  device = "pc",
}: {
  product: ProductInput;
  peers: ProductInput[];
  device?: PreviewDevice;
}) {
  // SKU切替リスト: 多SKU商品は variants[] を展開、フラット商品は peers から従来どおり構成。
  const entries = buildSkuEntries(product, peers);
  const [selectedNe, setSelectedNe] = useState(product.ne_code);
  const cur = entries.find((e) => e.v.ne_code === selectedNe) ?? entries[0];
  const page = cur.p; // 商品ページ共通（名前・説明・画像）
  const sku = cur.v; // SKU単位（価格・コード）
  // 商品管理番号: 取込商品は実際の管理番号を優先（CSVと同じ規則）。
  const base = page.rakuten_manage_number?.trim() || baseCode(page);

  // 商品画像 1..N: 取込した実画像URL(image_url_N)があればそれを優先。無ければ公開時と同じ自動生成規約
  //   1枚目 = thum02/{ne_code}.jpg、2枚目以降 = thum02/{base}_{n}.jpg
  const imageCount = Math.max(0, page.image_count || 0);
  const images = Array.from({ length: imageCount }, (_, k) => {
    const i = k + 1;
    return (
      imageUrlAt(page, i) ??
      (i === 1 ? `${RAKUTEN_IMAGE_BASE}/${sku.ne_code}.jpg` : `${RAKUTEN_IMAGE_BASE}/${baseCode(page)}_${i}.jpg`)
    );
  });

  // 販売説明文(imgList): 取込した実画像URL(2枚目以降)があればそれで組む。無ければ算出（公開時と同じ）。
  const explicitImgList = Array.from({ length: Math.max(0, imageCount - 1) }, (_, k) =>
    imageUrlAt(page, k + 2),
  ).filter((u): u is string => u !== null);
  const autoImgList =
    explicitImgList.length > 0
      ? explicitImgList.map((u) => `<img src="${u}" width="100%"><br>`).join("")
      : buildRakutenImgList(baseCode(page), imageCount);
  // PC用販売説明文: 任意入力があればそれを、空なら画像から組み立てた imgList(公開時と同じ)。
  const saleDescHtml = page.sale_description_pc.trim() ? page.sale_description_pc : autoImgList;
  // 登録時と同じ構成: PC = productDescription.pc / スマホ = productDescription.sp(imgList + SP説明文)
  const pcDescHtml = page.description_pc;
  const spDescHtml = autoImgList + page.description_sp;

  // 価格: 楽天は taxIncluded:true で登録するため、実ページ表示（N円）と同じ税込価格。
  const priceBlock = (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-3xl font-bold text-red-600">
        {sku.selling_price.toLocaleString()}
        <span className="text-lg">円</span>
      </span>
      {sku.shipping_type === "送料無料" && (
        <span className="text-sm font-bold text-red-600">送料無料</span>
      )}
      <span className="text-xs text-slate-400">(税込)</span>
    </div>
  );

  // バリエーション選択（多SKU）。実ページ同様、価格と数量の間に置く。
  const variantSelector = entries.length > 1 && (
    <div className="border border-slate-200 rounded p-3 space-y-2">
      <div className="text-sm font-semibold">{page.yahoo_variation_title || "タイプ"}:</div>
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
            <span className="text-slate-500">{e.v.selling_price.toLocaleString()}円</span>
          </label>
        ))}
      </div>
    </div>
  );

  // かごに追加 / 購入手続きへ（実ページの赤ボタン2つ・文言に合わせる）
  const cartButtons = (
    <div className="flex gap-2">
      <button className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded font-bold text-sm">
        ⊕ かごに追加
      </button>
      <button className="flex-1 bg-red-700 hover:bg-red-800 text-white py-3 rounded font-bold text-sm">
        🛒 購入手続きへ
      </button>
    </div>
  );

  const debugFooter = (
    <div className="text-xs text-slate-400 border-t border-slate-100 pt-2">
      商品管理番号: {base} / SKU: {sku.ne_code} / カタログ: {sku.jan_code} / 画像 {imageCount} 枚
    </div>
  );

  if (device === "sp") {
    // ── スマホ実ページの並び: カルーセル → 商品名 → キャッチコピー → 価格 → 数量 → かご → 商品説明(SP) ──
    return (
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">
          楽天市場 プレビュー（スマホ）
        </div>
        <div className="max-w-[390px] mx-auto space-y-4">
          <ImageCarousel images={images} />
          <h2 className="text-base font-bold leading-snug">
            {page.display_name || <span className="text-slate-400">(商品名未入力)</span>}
          </h2>
          {/* キャッチコピー: スマホ実ページは商品名の下（グレー小） */}
          {page.catch_copy_pc && <p className="text-sm text-slate-500">{page.catch_copy_pc}</p>}
          {priceBlock}
          {variantSelector}
          <QuantityRow />
          {cartButtons}
          <div className="border-t border-slate-200 pt-4">
            <div className="text-sm font-semibold mb-2">─── 商品説明（スマホ用: imgList＋スマホ用説明文）───</div>
            <HtmlPreviewFrame
              html={spDescHtml || '<p style="color:#94a3b8">(画像・スマホ用説明文 未入力)</p>'}
              title="楽天 スマホ商品説明プレビュー"
            />
          </div>
          {debugFooter}
        </div>
      </div>
    );
  }

  // ── PC 実ページの並び: 販売説明文 → 商品ブロック2カラム（左=画像 / 右=情報・購入・商品説明文） ──
  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-4">
      <div className="text-xs text-slate-400 uppercase tracking-wide">楽天市場 プレビュー（PC）</div>

      {/* 販売説明文（PC実ページでは商品ブロックより上に大きく表示される） */}
      {saleDescHtml && (
        <div>
          <div className="text-sm font-semibold mb-2">─── 販売説明文（PC: ページ上部）───</div>
          <HtmlPreviewFrame html={saleDescHtml} title="楽天 販売説明文プレビュー" />
        </div>
      )}

      {/* 商品ブロック（実ページは 左=商品画像＋サムネイル / 右=商品情報・購入ボタン・商品説明文） */}
      <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
        <div className="space-y-2">
          <div className="bg-slate-100 aspect-square flex items-center justify-center text-slate-400 rounded overflow-hidden">
            <ImageWithFallback src={images[0]} />
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-4 gap-1">
              {images.slice(1).map((u, i) => (
                <div key={u} className="bg-slate-100 aspect-square rounded overflow-hidden flex items-center justify-center text-[10px] text-slate-400">
                  <ImageWithFallback src={u} label={`${i + 2}`} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          {/* キャッチコピー: PC実ページは商品名の上（グレー小） */}
          {page.catch_copy_pc && <p className="text-sm text-slate-500">{page.catch_copy_pc}</p>}
          <h2 className="text-base font-bold leading-snug">
            {page.display_name || <span className="text-slate-400">(商品名未入力)</span>}
          </h2>
          <div className="text-xs text-slate-500">商品番号: {base}</div>
          {priceBlock}
          {variantSelector}
          <QuantityRow />
          {cartButtons}
          <div className="border-t border-slate-200 pt-3">
            <div className="text-sm font-semibold mb-2">─── 商品説明文（PC）───</div>
            <HtmlPreviewFrame
              html={pcDescHtml || '<p style="color:#94a3b8">(PC用商品説明文 未入力)</p>'}
              title="楽天 PC商品説明プレビュー"
            />
          </div>
        </div>
      </div>

      {debugFooter}
    </div>
  );
}
