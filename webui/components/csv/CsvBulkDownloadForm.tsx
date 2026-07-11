"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { HelpLink } from "@/components/help/HelpLink";
import { matchesProductQuery } from "@/lib/product/search";

type ProductItem = { id: string; ne_code: string; product_name: string };

const MALL_OPTIONS = [
  { key: "rakuten", label: "楽天 (normal-item.csv, cp932)" },
  { key: "yahoo", label: "Yahoo (yahoo.csv, cp932)" },
  { key: "ne_single", label: "NE 単品 (ne_single.csv, utf-8)" },
  { key: "ne_set", label: "NE セット (ne_set.csv, utf-8)" },
  { key: "shopify", label: "Shopify (shopify.csv, utf-8-sig)" },
];

export function CsvBulkDownloadForm({
  products,
  initialSelectedIds,
}: {
  products: ProductItem[];
  /** 商品一覧の「選択を一括 CSV 出力」から引き継いだ初期チェックID。未指定なら全チェック。 */
  initialSelectedIds?: string[];
}) {
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? products.map((p) => p.id)),
  );
  const [selectedMalls, setSelectedMalls] = useState<Set<string>>(
    new Set(MALL_OPTIONS.map((m) => m.key)),
  );
  const [query, setQuery] = useState("");
  const [downloading, setDownloading] = useState(false);

  // 商品一覧と同じ共有ロジック（matchesProductQuery）で表示リストを絞り込む
  const filteredProducts = useMemo(
    () => products.filter((p) => matchesProductQuery(p, query)),
    [products, query],
  );
  const filtering = query.trim() !== "";

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
  /** 選択を「いま絞り込んで表示している商品のIDのみ」に置き換える。 */
  const selectFilteredOnly = () => setSelectedProducts(new Set(filteredProducts.map((p) => p.id)));

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
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">CSV ダウンロード</h1>
        <HelpLink anchor="screen-csv" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">1. 出力対象の商品</h2>
          <div className="text-xs text-slate-500">
            {selectedProducts.size} / {products.length} 件選択中
          </div>
        </div>
        {initialSelectedIds && (
          <p className="mb-2 text-xs text-slate-600">
            💡 商品一覧で選択した {initialSelectedIds.length} 件を初期選択しています（ここで追加・解除もできます）
          </p>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 NEコード・商品名で検索"
            className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          {filtering && (
            <span className="text-xs text-slate-500">
              {filteredProducts.length} 件表示中（全 {products.length} 件）
            </span>
          )}
        </div>
        <div className="space-x-2 mb-2">
          <Button onClick={selectAllProducts} variant="outline" className="text-xs">
            全選択
          </Button>
          <Button onClick={clearProducts} variant="outline" className="text-xs">
            選択解除
          </Button>
          {filtering && (
            <Button
              onClick={selectFilteredOnly}
              variant="outline"
              className="text-xs"
              title="選択を、いま表示している商品だけに置き換えます"
            >
              絞り込んだ結果だけ全選択（{filteredProducts.length} 件）
            </Button>
          )}
        </div>
        {filtering && (
          <p className="mb-2 text-xs text-slate-500">
            ⚠ 「全選択」「選択解除」は絞り込み中も全商品が対象です。表示中だけ選びたいときは「絞り込んだ結果だけ全選択」を使ってください
          </p>
        )}
        <div className="border border-slate-200 rounded bg-white max-h-72 overflow-y-auto">
          {products.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">商品がありません</p>
          ) : filteredProducts.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">検索条件に一致する商品がありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredProducts.map((p) => (
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
