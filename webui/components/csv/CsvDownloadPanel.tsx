"use client";

import { cn } from "@/lib/utils";

const malls = [
  { key: "rakuten", label: "楽天", color: "border-red-400 text-red-700 hover:bg-red-50" },
  { key: "yahoo", label: "Yahoo", color: "border-red-500 text-red-700 hover:bg-red-50" },
  { key: "ne_single", label: "NE 単品", color: "border-slate-400 text-slate-700 hover:bg-slate-50" },
  { key: "ne_set", label: "NE セット", color: "border-slate-400 text-slate-700 hover:bg-slate-50" },
  { key: "shopify", label: "Shopify", color: "border-green-700 text-green-800 hover:bg-green-50" },
];

export function CsvDownloadPanel({ productId }: { productId?: string }) {
  if (!productId) {
    return (
      <div className="bg-white border border-slate-200 rounded p-4 text-sm text-slate-500">
        💡 商品を保存すると、 CSV ダウンロードが有効になります
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="font-semibold mb-2">📥 CSV ダウンロード</div>
      <div className="flex flex-wrap gap-2">
        {malls.map((m) => (
          <a
            key={m.key}
            href={`/api/csv/${m.key}/${productId}`}
            download
            className={cn(
              "px-3 py-2 text-sm font-medium border rounded transition-colors",
              m.color,
            )}
          >
            {m.label}
          </a>
        ))}
      </div>
    </div>
  );
}
