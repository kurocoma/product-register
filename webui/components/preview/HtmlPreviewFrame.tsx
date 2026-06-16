"use client";

import * as React from "react";

/** 楽天等の生HTML(説明文・imgList)を iframe で隔離描画する。
 * Tailwind の preflight/prose の影響を受けず、<table border> や <font>、
 * <img width="100%"> がブラウザ既定スタイルで（＝モール実ページに近い形で）表示される。
 * sandbox="allow-same-origin" でスクリプトは無効化しつつ、高さ自動調整のため
 * 同一オリジンとして中身の高さを測定する。 */
export function HtmlPreviewFrame({ html, title }: { html: string; title?: string }) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(120);

  const srcDoc =
    `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
    `<style>` +
    `html,body{margin:0;padding:0}` +
    `body{font-family:-apple-system,'Segoe UI','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;` +
    `font-size:13px;line-height:1.7;color:#333;word-break:break-word}` +
    `img{max-width:100%;height:auto}` +
    `table{max-width:100%}` +
    `</style></head><body>${html}</body></html>`;

  const adjust = React.useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setHeight(doc.body.scrollHeight + 8);
  }, []);

  const handleLoad = React.useCallback(() => {
    adjust();
    // 画像は遅延ロードされるため、各画像の読込/失敗後に再計測する
    const doc = ref.current?.contentDocument;
    doc?.querySelectorAll("img").forEach((img) => {
      const el = img as HTMLImageElement;
      if (!el.complete) {
        el.addEventListener("load", adjust, { once: true });
        el.addEventListener("error", adjust, { once: true });
      }
    });
  }, [adjust]);

  return (
    <iframe
      ref={ref}
      title={title ?? "preview"}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      onLoad={handleLoad}
      className="w-full block border-0 bg-white"
      style={{ height }}
    />
  );
}
