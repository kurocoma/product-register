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
            {filtered.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleOne(p.id)}
                  />
                </td>
                <td className="px-3 py-2 font-mono">{String(p.ne_code)}</td>
                <td className="px-3 py-2">
                  <Link href={`/products/${p.id}`} className="text-blue-600 hover:underline">
                    {String(p.product_name)}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right">¥{Number(p.selling_price).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{String(p.product_type)}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="flex gap-2 text-sm text-slate-600">
          {selected.size} 件選択中
          <Link
            href={`/csv?ids=${Array.from(selected).join(",")}`}
            className="text-blue-600 hover:underline"
          >
            選択した商品を一括 CSV 出力
          </Link>
        </div>
      )}
    </div>
  );
}
