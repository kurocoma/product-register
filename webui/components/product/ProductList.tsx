"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { deleteProduct } from "@/lib/product/repository";
import type { ProductRow } from "@/lib/product/repository";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProductList({ initial }: { initial: ProductRow[] }) {
  const router = useRouter();
  const [products, setProducts] = useState(initial);
  const [query, setQuery] = useState("");
  const [makerFilter, setMakerFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priceMode, setPriceMode] = useState<"pct" | "yen" | "set">("pct");
  const [priceValue, setPriceValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const makers = useMemo(() => {
    return Array.from(new Set(products.map((p) => String(p.maker_code)))).sort();
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (makerFilter && p.maker_code !== makerFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        const code = String(p.ne_code).toLowerCase();
        const name = String(p.product_name).toLowerCase();
        if (!code.includes(q) && !name.includes(q)) return false;
      }
      return true;
    });
  }, [products, query, makerFilter]);

  const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelected(new Set(filtered.map((p) => p.id)));
    else setSelected(new Set());
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const MODE_LABEL = { pct: "％で増減", yen: "円で増減", set: "固定額に設定" } as const;

  const applyBulkPrice = async () => {
    const value = Number(priceValue);
    if (!Number.isFinite(value)) {
      setBulkMsg("変更値を数値で入力してください");
      return;
    }
    if (priceMode !== "set" && value === 0) {
      setBulkMsg("増減値を入力してください（例: 10 で +10%、-5 で -5%）");
      return;
    }
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const ids = Array.from(selected);
      const res = await fetch("/api/products/bulk-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, mode: priceMode, value }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setBulkMsg(`失敗: ${j.error || `HTTP ${res.status}`}`);
        return;
      }
      // 反映後の価格でリストを更新
      const byId = new Map<string, number>((j.results || []).filter((r: { ok: boolean }) => r.ok).map((r: { id: string; sellingPrice: number }) => [r.id, r.sellingPrice]));
      setProducts((prev) => prev.map((p) => (byId.has(p.id) ? { ...p, selling_price: byId.get(p.id)! } : p)));
      setBulkMsg(`✓ ${j.updated} 件更新${j.failed ? ` / ${j.failed} 件失敗` : ""}（販売価格・表示価格を一括変更）`);
      setPriceValue("");
    } catch (e) {
      setBulkMsg("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この商品を削除しますか？")) return;
    const supabase = createClient();
    await deleteProduct(supabase, id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">商品一覧</h1>
        <Link href="/products/new">
          <Button>+ 新規商品</Button>
        </Link>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="🔍 NEコードまたは商品名で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={makerFilter}
          onChange={(e) => setMakerFilter(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">全メーカー</option>
          {makers.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2">NEコード</th>
              <th className="px-3 py-2">商品名</th>
              <th className="px-3 py-2 text-right">価格</th>
              <th className="px-3 py-2">種別</th>
              <th className="px-3 py-2 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  商品がありません。「+ 新規商品」から登録してください。
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const name = String(p.product_name).trim();
              const neCode = String(p.ne_code).trim();
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/products/${p.id}`)}
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                >
                  {/* チェックボックス: 行遷移を止める */}
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleOne(p.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {neCode || <span className="text-slate-400">(NEコード未設定)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/products/${p.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:underline"
                    >
                      {name || <span className="text-slate-400 italic">(名称未設定)</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right">¥{Number(p.selling_price).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{String(p.product_type)}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <Link
                        href={`/products/${p.id}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        編集
                      </Link>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{selected.size} 件選択中</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">販売価格を一括編集:</span>
            <select
              value={priceMode}
              onChange={(e) => setPriceMode(e.target.value as "pct" | "yen" | "set")}
              className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              {(["pct", "yen", "set"] as const).map((m) => (
                <option key={m} value={m}>{MODE_LABEL[m]}</option>
              ))}
            </select>
            <input
              type="number"
              value={priceValue}
              onChange={(e) => setPriceValue(e.target.value)}
              placeholder={priceMode === "pct" ? "例: 10 (=+10%)" : priceMode === "yen" ? "例: 100 (=+100円)" : "例: 1980"}
              className="w-40 rounded border border-slate-300 px-2 py-1.5 text-sm text-right"
            />
            <span className="text-slate-500">{priceMode === "pct" ? "%" : "円"}</span>
            <Button onClick={applyBulkPrice} disabled={bulkBusy}>
              {bulkBusy ? "適用中…" : "一括適用"}
            </Button>
            <span className="text-slate-300">|</span>
            <Link href={`/csv?ids=${Array.from(selected).join(",")}`} className="text-blue-600 hover:underline">
              選択を一括 CSV 出力
            </Link>
          </div>
          {bulkMsg && <p className="text-sm text-slate-700">{bulkMsg}</p>}
          <p className="text-[11px] text-slate-400">
            販売価格と表示価格は連動します（CSV/Yahooの表示価格＝販売価格、Yahoo反映時も original_price を同期）。
            多SKU商品は各SKUの販売価格にも同じ操作を適用します。値上げ後はモール編集の「反映」で各モールへ送れます。
          </p>
        </div>
      )}
    </div>
  );
}
