"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type ProductItem = { id: string; ne_code: string; product_name: string };

const MALL_OPTIONS = [
  { key: "rakuten", label: "楽天 (normal-item.csv, cp932)" },
  { key: "yahoo", label: "Yahoo (yahoo.csv, cp932)" },
  { key: "ne_single", label: "NE 単品 (ne_single.csv, utf-8)" },
  { key: "ne_set", label: "NE セット (ne_set.csv, utf-8)" },
  { key: "shopify", label: "Shopify (shopify.csv, utf-8-sig)" },
];

export function CsvBulkDownloadForm({ products }: { products: ProductItem[] }) {
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    new Set(products.map((p) => p.id)),
  );
  const [selectedMalls, setSelectedMalls] = useState<Set<string>>(
    new Set(MALL_OPTIONS.map((m) => m.key)),
  );
  const [downloading, setDownloading] = useState(false);

  const toggleProduct = (id: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMall = (key: string) => {
    setSelectedMalls((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllProducts = () => setSelectedProducts(new Set(products.map((p) => p.id)));
  const clearProducts = () => setSelectedProducts(new Set());

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/csv/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: Array.from(selectedProducts),
          malls: Array.from(selectedMalls),
        }),
      });
      if (!res.ok) {
        alert("ダウンロード失敗: " + (await res.text()));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `csv-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">CSV ダウンロード</h1>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">1. 出力対象の商品</h2>
          <div className="text-xs text-slate-500">
            {selectedProducts.size} / {products.length} 件選択中
          </div>
        </div>
        <div className="space-x-2 mb-2">
          <Button onClick={selectAllProducts} variant="outline" className="text-xs">
            全選択
          </Button>
          <Button onClick={clearProducts} variant="outline" className="text-xs">
            選択解除
          </Button>
        </div>
        <div className="border border-slate-200 rounded bg-white max-h-72 overflow-y-auto">
          {products.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">商品がありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {products.map((p) => (
                <li key={p.id} className="px-3 py-2 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedProducts.has(p.id)}
                    onChange={() => toggleProduct(p.id)}
                  />
                  <span className="font-mono text-xs w-32">{p.ne_code}</span>
                  <span className="text-sm flex-1 truncate">{p.product_name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-2">2. 出力モール</h2>
        <ul className="space-y-1">
          {MALL_OPTIONS.map((m) => (
            <li key={m.key}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedMalls.has(m.key)}
                  onChange={() => toggleMall(m.key)}
                />
                {m.label}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <Button
          onClick={handleDownload}
          disabled={downloading || selectedProducts.size === 0 || selectedMalls.size === 0}
        >
          {downloading ? "生成中..." : "📥 一括ダウンロード (ZIP)"}
        </Button>
      </div>
    </div>
  );
}
