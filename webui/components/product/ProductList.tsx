"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { deleteProduct } from "@/lib/product/repository";
import type { ProductRow } from "@/lib/product/repository";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mall = "rakuten" | "yahoo";
const MALL_LABEL: Record<Mall, string> = { rakuten: "楽天", yahoo: "Yahoo" };

export function ProductList({ initial }: { initial: ProductRow[] }) {
  const [products, setProducts] = useState(initial);
  const [query, setQuery] = useState("");
  const [makerFilter, setMakerFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 価格インライン編集の下書き（id → 文字列）。スムーズに打てるよう products とは別に保持。
  const [draft, setDraft] = useState<Record<string, { selling: string; display: string }>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [reflectMsg, setReflectMsg] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<{ running: boolean; mall: Mall; done: number; total: number; ok: number; ng: number } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const makers = useMemo(() => Array.from(new Set(products.map((p) => String(p.maker_code)))).sort(), [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (makerFilter && p.maker_code !== makerFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!String(p.ne_code).toLowerCase().includes(q) && !String(p.product_name).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [products, query, makerFilter]);

  const isMulti = (p: ProductRow) => {
    const v = (p.extra as { variants?: unknown[] })?.variants;
    return Array.isArray(v) && v.length > 0;
  };
  const dispPriceOf = (p: ProductRow) => {
    const dp = Number((p.extra as { display_price?: number })?.display_price);
    return dp > 0 ? dp : Number(p.selling_price);
  };
  const draftOf = (p: ProductRow) => draft[p.id] ?? { selling: String(Number(p.selling_price)), display: String(dispPriceOf(p)) };

  const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelected(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set());
  };
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 価格編集 → 下書き更新 + 商品stateへ反映 + デバウンス自動保存。販売価格編集時は表示価格を同額に連動。 */
  const editPrice = (p: ProductRow, field: "selling" | "display", value: string) => {
    const cur = draftOf(p);
    const next = { ...cur, [field]: value };
    if (field === "selling") next.display = value; // 連動: 販売価格→表示価格
    setDraft((d) => ({ ...d, [p.id]: next }));

    const selling = Math.max(0, Math.round(Number(next.selling)));
    const display = Math.max(0, Math.round(Number(next.display)));
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, selling_price: selling, extra: { ...x.extra, display_price: display } } : x)));

    if (!Number.isFinite(Number(next.selling)) || !Number.isFinite(Number(next.display))) return;
    setSaveState((s) => ({ ...s, [p.id]: "saving" }));
    clearTimeout(timers.current[p.id]);
    timers.current[p.id] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/${p.id}/price`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selling_price: selling, display_price: display }),
        });
        const j = await res.json();
        setSaveState((s) => ({ ...s, [p.id]: res.ok && j.ok ? "saved" : "error" }));
      } catch {
        setSaveState((s) => ({ ...s, [p.id]: "error" }));
      }
    }, 700);
  };

  const reflectOne = async (id: string, mall: Mall): Promise<boolean> => {
    setReflectMsg((r) => ({ ...r, [id]: `${MALL_LABEL[mall]}反映中…` }));
    try {
      const res = await fetch(`/api/update/${mall}/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await res.json();
      const ok = res.ok && j.ok;
      setReflectMsg((r) => ({ ...r, [id]: ok ? (j.noChange ? `${MALL_LABEL[mall]}: 変更なし` : `✓ ${MALL_LABEL[mall]}反映`) : `${MALL_LABEL[mall]}: ${(j.error || "失敗").slice(0, 50)}` }));
      return ok;
    } catch (e) {
      setReflectMsg((r) => ({ ...r, [id]: "通信エラー: " + (e instanceof Error ? e.message : String(e)) }));
      return false;
    }
  };

  const reflectBulk = async (mall: Mall) => {
    if (bulk?.running) return;
    const ids = Array.from(selected);
    setBulk({ running: true, mall, done: 0, total: ids.length, ok: 0, ng: 0 });
    for (let i = 0; i < ids.length; i++) {
      const ok = await reflectOne(ids[i], mall);
      setBulk((b) => (b ? { ...b, done: i + 1, ok: b.ok + (ok ? 1 : 0), ng: b.ng + (ok ? 0 : 1) } : b));
    }
    setBulk((b) => (b ? { ...b, running: false } : b));
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
        <Link href="/products/new"><Button>+ 新規商品</Button></Link>
      </div>

      <div className="flex gap-2">
        <Input placeholder="🔍 NEコードまたは商品名で検索" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
        <select value={makerFilter} onChange={(e) => setMakerFilter(e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="">全メーカー</option>
          {makers.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
      </div>

      <div className="bg-white rounded border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2 w-10">
                <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleAll} />
              </th>
              <th className="px-3 py-2">NEコード</th>
              <th className="px-3 py-2">商品名</th>
              <th className="px-3 py-2 text-right">販売価格 / 表示価格</th>
              <th className="px-3 py-2">反映</th>
              <th className="px-3 py-2 w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">商品がありません。「+ 新規商品」から登録してください。</td></tr>
            )}
            {filtered.map((p) => {
              const name = String(p.product_name).trim();
              const neCode = String(p.ne_code).trim();
              const d = draftOf(p);
              return (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} /></td>
                  <td className="px-3 py-2 font-mono">{neCode || <span className="text-slate-400">(未設定)</span>}</td>
                  <td className="px-3 py-2">
                    <Link href={`/products/${p.id}`} className="text-blue-600 hover:underline">
                      {name || <span className="text-slate-400 italic">(名称未設定)</span>}
                    </Link>
                  </td>
                  {/* 販売価格・表示価格 インライン編集（多SKUは編集画面でSKU別に） */}
                  <td className="px-3 py-2">
                    {isMulti(p) ? (
                      <div className="text-right text-slate-600">
                        ¥{Number(p.selling_price).toLocaleString()}
                        <Link href={`/products/${p.id}`} className="ml-1 text-[10px] text-amber-600 hover:underline">多SKU(編集)</Link>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <label className="flex items-center justify-end gap-1">
                          <span className="text-[10px] text-slate-400 w-8 text-right">販売</span>
                          <input type="number" value={d.selling} onChange={(e) => editPrice(p, "selling", e.target.value)}
                            className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
                        </label>
                        <label className="flex items-center justify-end gap-1">
                          <span className="text-[10px] text-slate-400 w-8 text-right">表示</span>
                          <input type="number" value={d.display} onChange={(e) => editPrice(p, "display", e.target.value)}
                            className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
                        </label>
                        {saveState[p.id] && (
                          <div className={`text-right text-[10px] ${saveState[p.id] === "error" ? "text-red-600" : saveState[p.id] === "saving" ? "text-slate-400" : "text-green-700"}`}>
                            {saveState[p.id] === "saving" ? "保存中…" : saveState[p.id] === "saved" ? "✓自動保存" : "保存失敗"}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  {/* 反映（モール選択式） */}
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-1">
                        <button onClick={() => reflectOne(p.id, "rakuten")} className="rounded border border-rose-300 text-rose-700 px-1.5 py-0.5 text-xs hover:bg-rose-50">楽天へ反映</button>
                        <button onClick={() => reflectOne(p.id, "yahoo")} className="rounded border border-purple-300 text-purple-700 px-1.5 py-0.5 text-xs hover:bg-purple-50">Yahooへ反映</button>
                      </div>
                      {reflectMsg[p.id] && <span className="text-[10px] text-slate-600">{reflectMsg[p.id]}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <Link href={`/products/${p.id}`} className="text-xs text-blue-600 hover:underline">編集</Link>
                      <button onClick={() => handleDelete(p.id)} className="text-xs text-red-600 hover:underline">削除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="rounded border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{selected.size} 件選択中</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-600">一括反映:</span>
          <button onClick={() => reflectBulk("rakuten")} disabled={bulk?.running} className="rounded bg-rose-600 px-3 py-1.5 text-white hover:bg-rose-700 disabled:opacity-50">楽天へ一括反映</button>
          <button onClick={() => reflectBulk("yahoo")} disabled={bulk?.running} className="rounded bg-purple-600 px-3 py-1.5 text-white hover:bg-purple-700 disabled:opacity-50">Yahooへ一括反映</button>
          {bulk && (
            <span className={bulk.running ? "text-blue-700" : "text-slate-600"}>
              {bulk.running ? `反映中… ${bulk.done}/${bulk.total}（${MALL_LABEL[bulk.mall]}）` : `完了（${MALL_LABEL[bulk.mall]}）: 成功 ${bulk.ok} / 失敗 ${bulk.ng}`}
            </span>
          )}
          <span className="text-slate-300">|</span>
          <Link href={`/csv?ids=${Array.from(selected).join(",")}`} className="text-blue-600 hover:underline">選択を一括 CSV 出力</Link>
        </div>
      )}
    </div>
  );
}
