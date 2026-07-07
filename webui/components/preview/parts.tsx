"use client";

import * as React from "react";

/** 読み込み失敗時に「(未アップロード)」を出す商品画像。プレビューは実アップロード先の画像だけを描画する。 */
export function ImageWithFallback({ src, label }: { src?: string; label?: string }) {
  const [failed, setFailed] = React.useState(false);
  // src が変わったら失敗状態をリセット（レンダー中の状態リセットパターン）
  const [prevSrc, setPrevSrc] = React.useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setFailed(false);
  }
  if (!src || failed) {
    return <span className="text-slate-400 text-xs">{label ? `(${label} 未アップロード)` : "(画像 未アップロード)"}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
  );
}

/** 実ページのスマホ画像カルーセル相当（‹ › 切替 + n/N カウンタ）。images は実URLの配列。 */
export function ImageCarousel({ images }: { images: string[] }) {
  const [idx, setIdx] = React.useState(0);
  const count = images.length;
  const cur = Math.min(idx, Math.max(0, count - 1));
  if (count === 0) {
    return (
      <div className="bg-slate-100 aspect-square flex items-center justify-center text-slate-400 rounded">
        (画像 未設定)
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="relative bg-slate-100 aspect-square rounded overflow-hidden flex items-center justify-center">
        <ImageWithFallback src={images[cur]} label={`画像${cur + 1}`} />
        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="前の画像"
              onClick={() => setIdx((cur + count - 1) % count)}
              className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-white/80 border border-slate-200 w-8 h-8 text-slate-600 hover:bg-white"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="次の画像"
              onClick={() => setIdx((cur + 1) % count)}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-white/80 border border-slate-200 w-8 h-8 text-slate-600 hover:bg-white"
            >
              ›
            </button>
          </>
        )}
      </div>
      <div className="text-center text-xs text-slate-500">
        {cur + 1}/{count}
      </div>
    </div>
  );
}

/** 実ページの数量ステッパー相当（プレビュー用の見た目のみ）。 */
export function QuantityRow() {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-700">数量</span>
      <div className="flex items-center border border-slate-300 rounded">
        <span className="px-3 py-1 text-slate-400 select-none">−</span>
        <span className="px-4 py-1 border-x border-slate-200">1</span>
        <span className="px-3 py-1 text-slate-400 select-none">＋</span>
      </div>
    </div>
  );
}
