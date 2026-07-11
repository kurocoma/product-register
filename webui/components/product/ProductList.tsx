"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { deleteProduct } from "@/lib/product/repository";
import type { ProductRow } from "@/lib/product/repository";
import { mallPresence } from "@/lib/product/schema";
import { matchesProductQuery, matchesListedFilter, type ListedFilter } from "@/lib/product/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpLink } from "@/components/help/HelpLink";
import { BulkRegisterPanel } from "./BulkRegisterPanel";

type Mall = "rakuten" | "yahoo";
const MALL_LABEL: Record<Mall, string> = { rakuten: "楽天", yahoo: "Yahoo" };

type StoredVariant = { sku_manage_number?: string; ne_code?: string; variation_value?: string; selling_price?: number; display_price?: number };
type PriceRow = { key: string; variantIndex: number | null; label: string; selling: number; display: number };

const variantsOf = (p: ProductRow): StoredVariant[] => ((p.extra as { variants?: StoredVariant[] })?.variants ?? []);
/** その商品が各モールに掲載済みか（反映ボタンの活性判定・掲載状況の絞り込み）。
 * 判定は共有の mallPresence()（lib/product/schema.ts）へ委譲し、情報源を一本化する。 */
const presenceOf = (p: ProductRow): Record<Mall, boolean> => {
  const { rakuten, yahoo } = mallPresence((p.extra ?? {}) as Parameters<typeof mallPresence>[0]);
  return { rakuten, yahoo };
};
const flatDisplay = (p: ProductRow) => {
  const dp = Number((p.extra as { display_price?: number })?.display_price);
  return dp > 0 ? dp : Number(p.selling_price);
};
const priceRows = (p: ProductRow): PriceRow[] => {
  const vs = variantsOf(p);
  if (vs.length === 0) return [{ key: p.id, variantIndex: null, label: "", selling: Number(p.selling_price), display: flatDisplay(p) }];
  return vs.map((v, idx) => {
    const selling = Number(v.selling_price ?? 0);
    const dp = Number(v.display_price ?? 0);
    return { key: `${p.id}:${idx}`, variantIndex: idx, label: v.variation_value || v.sku_manage_number || v.ne_code || `SKU${idx + 1}`, selling, display: dp > 0 ? dp : selling };
  });
};

export function ProductList({ initial }: { initial: ProductRow[] }) {
  const [products, setProducts] = useState(initial);
  const [query, setQuery] = useState("");
  const [makerFilter, setMakerFilter] = useState("");
  const [listedFilter, setListedFilter] = useState<{ rakuten: ListedFilter; yahoo: ListedFilter }>({ rakuten: "", yahoo: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, { selling: string; display: string }>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [reflectMsg, setReflectMsg] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<{ running: boolean; mall: Mall; done: number; total: number; ok: number; ng: number; failed: string[] } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const makers = useMemo(() => Array.from(new Set(products.map((p) => String(p.maker_code)))).sort(), [products]);
  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (makerFilter && p.maker_code !== makerFilter) return false;
      const fields = {
        ne_code: String(p.ne_code ?? ""),
        product_name: String(p.product_name ?? ""),
        jan_code: String(p.jan_code ?? ""),
      };
      if (!matchesProductQuery(fields, query)) return false;
      // 掲載状況の絞り込みは反映ボタンの活性化と同じ情報源（mallPresence）で判定する
      if (!matchesListedFilter(presenceOf(p), listedFilter)) return false;
      return true;
    });
  }, [products, query, makerFilter, listedFilter]);

  const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => setSelected(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set());
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 価格編集（フラット or 多SKUの1バリエーション）→ 下書き更新 + 商品stateへ反映 + デバウンス自動保存。
   * 販売価格を変えると表示価格も同額に連動。 */
  const editPrice = (p: ProductRow, r: PriceRow, field: "selling" | "display", value: string) => {
    const base = draft[r.key] ?? { selling: String(r.selling), display: String(r.display) };
    const next = { ...base, [field]: value };
    if (field === "selling") next.display = value; // 連動
    setDraft((d) => ({ ...d, [r.key]: next }));

    const selling = Math.max(0, Math.round(Number(next.selling)));
    const display = Math.max(0, Math.round(Number(next.display)));
    setProducts((prev) =>
      prev.map((x) => {
        if (x.id !== p.id) return x;
        if (r.variantIndex == null) return { ...x, selling_price: selling, extra: { ...x.extra, display_price: display } };
        const vs = variantsOf(x).map((v, i) => (i === r.variantIndex ? { ...v, selling_price: selling, display_price: display } : v));
        const extra = { ...x.extra, variants: vs, ...(r.variantIndex === 0 ? { display_price: display } : {}) };
        return { ...x, ...(r.variantIndex === 0 ? { selling_price: selling } : {}), extra };
      }),
    );

    if (!Number.isFinite(Number(next.selling)) || !Number.isFinite(Number(next.display))) return;
    setSaveState((s) => ({ ...s, [r.key]: "saving" }));
    clearTimeout(timers.current[r.key]);
    timers.current[r.key] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/${p.id}/price`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selling_price: selling, display_price: display, variantIndex: r.variantIndex ?? undefined }),
        });
        const j = await res.json();
        setSaveState((s) => ({ ...s, [r.key]: res.ok && j.ok ? "saved" : "error" }));
      } catch {
        setSaveState((s) => ({ ...s, [r.key]: "error" }));
      }
    }, 700);
  };

  const reflectOne = async (id: string, mall: Mall): Promise<boolean> => {
    setReflectMsg((r) => ({ ...r, [id]: `${MALL_LABEL[mall]}反映中…` }));
    try {
      const res = await fetch(`/api/update/${mall}/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await res.json();
      const ok = res.ok && j.ok;
      // 失敗理由は打ち切らず全文を保持する（行内表示側で省略＋クリックで全文展開）
      setReflectMsg((r) => ({ ...r, [id]: ok ? (j.noChange ? `${MALL_LABEL[mall]}: 変更なし` : `✓ ${MALL_LABEL[mall]}反映`) : `${MALL_LABEL[mall]}: ${j.error || "失敗"}` }));
      return ok;
    } catch (e) {
      setReflectMsg((r) => ({ ...r, [id]: "通信エラー: " + (e instanceof Error ? e.message : String(e)) }));
      return false;
    }
  };

  const bulkTargets = (mall: Mall) =>
    Array.from(selected).filter((id) => {
      const p = products.find((x) => x.id === id);
      return p && presenceOf(p)[mall];
    });

  /** 選択商品（または retryIds 指定時はその商品だけ）を1件ずつ順番にモールへ反映する。
   * 完了後に失敗があれば「失敗した分だけ再実行」ボタンから retryIds 付きで呼び直せる。 */
  const reflectBulk = async (mall: Mall, retryIds?: string[]) => {
    if (bulk?.running) return;
    const ids = retryIds ?? bulkTargets(mall);
    if (ids.length === 0) {
      setBulk({ running: false, mall, done: 0, total: 0, ok: 0, ng: 0, failed: [] });
      return;
    }
    setBulk({ running: true, mall, done: 0, total: ids.length, ok: 0, ng: 0, failed: [] });
    for (let i = 0; i < ids.length; i++) {
      const ok = await reflectOne(ids[i], mall);
      setBulk((b) => (b ? { ...b, done: i + 1, ok: b.ok + (ok ? 1 : 0), ng: b.ng + (ok ? 0 : 1), failed: ok ? b.failed : [...b.failed, ids[i]] } : b));
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

  /** 反映結果メッセージの行内表示。50文字を超える失敗理由は省略表示にし、
   * クリック（<details> 展開）で全文が読めるようにする。短い場合はそのまま表示。 */
  const reflectMsgView = (msg: string) =>
    msg.length <= 50 ? (
      <span className="text-[10px] text-slate-600">{msg}</span>
    ) : (
      <details className="text-[10px] text-slate-600">
        <summary className="cursor-pointer hover:text-blue-600" title="クリックで全文を表示">
          {msg.slice(0, 50)}…（クリックで全文）
        </summary>
        <div className="mt-0.5 max-w-xs whitespace-pre-wrap break-all rounded border border-slate-200 bg-slate-50 p-1">{msg}</div>
      </details>
    );

  const saveBadge = (key: string) =>
    saveState[key] ? (
      <div className={`text-right text-[10px] ${saveState[key] === "error" ? "text-red-600" : saveState[key] === "saving" ? "text-slate-400" : "text-green-700"}`}>
        {saveState[key] === "saving" ? "保存中…" : saveState[key] === "saved" ? "✓自動保存" : "保存失敗"}
      </div>
    ) : null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">商品一覧</h1>
          <HelpLink anchor="screen-products" />
        </div>
        <Link href="/products/new"><Button>+ 新規商品</Button></Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input placeholder="🔍 NEコード・商品名・JANコードで検索" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
        <select value={makerFilter} onChange={(e) => setMakerFilter(e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="">全メーカー</option>
          {makers.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
        {(["rakuten", "yahoo"] as Mall[]).map((m) => (
          <select
            key={m}
            value={listedFilter[m]}
            onChange={(e) => setListedFilter((f) => ({ ...f, [m]: e.target.value as ListedFilter }))}
            title={`${MALL_LABEL[m]}の掲載状況で絞り込み（反映ボタンの活性化と同じ判定）`}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">{MALL_LABEL[m]}: 全て</option>
            <option value="listed">{MALL_LABEL[m]}: 掲載中</option>
            <option value="unlisted">{MALL_LABEL[m]}: 未掲載</option>
          </select>
        ))}
      </div>

      <div className="bg-white rounded border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2 w-10"><input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleAll} /></th>
              <th className="px-3 py-2">NEコード</th>
              <th className="px-3 py-2">商品名</th>
              <th className="px-3 py-2 text-right">販売価格 / 表示価格<br /><span className="text-[10px] font-normal text-slate-400">多SKUはSKU別</span></th>
              <th className="px-3 py-2">反映</th>
              <th className="px-3 py-2 w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">商品がありません。「+ 新規商品」から登録してください。</td></tr>
            )}
            {filtered.map((p) => {
              const rows = priceRows(p);
              const multi = variantsOf(p).length > 1;
              return (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} /></td>
                  <td className="px-3 py-2 font-mono">{String(p.ne_code).trim() || <span className="text-slate-400">(未設定)</span>}</td>
                  <td className="px-3 py-2">
                    <Link href={`/products/${p.id}`} className="text-blue-600 hover:underline">
                      {String(p.product_name).trim() || <span className="text-slate-400 italic">(名称未設定)</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-2">
                      {multi && <div className="text-[10px] text-amber-600">{rows.length} バリエーション（SKU別に編集）</div>}
                      {rows.map((r) => {
                        const dr = draft[r.key] ?? { selling: String(r.selling), display: String(r.display) };
                        return (
                          <div key={r.key} className="space-y-0.5">
                            {multi && r.label && <div className="text-[10px] text-slate-500 font-mono">{r.label}</div>}
                            <label className="flex items-center justify-end gap-1">
                              <span className="text-[10px] text-slate-400 w-8 text-right">販売</span>
                              <input type="number" value={dr.selling} onChange={(e) => editPrice(p, r, "selling", e.target.value)} className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
                            </label>
                            <label className="flex items-center justify-end gap-1">
                              <span className="text-[10px] text-slate-400 w-8 text-right">表示</span>
                              <input type="number" value={dr.display} onChange={(e) => editPrice(p, r, "display", e.target.value)} className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
                            </label>
                            {saveBadge(r.key)}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-1">
                        {(["rakuten", "yahoo"] as Mall[]).map((m) => {
                          const on = presenceOf(p)[m];
                          const color = m === "rakuten" ? "border-rose-300 text-rose-700 hover:bg-rose-50" : "border-purple-300 text-purple-700 hover:bg-purple-50";
                          return (
                            <button
                              key={m}
                              onClick={() => on && reflectOne(p.id, m)}
                              disabled={!on}
                              title={on ? "" : `この商品は${MALL_LABEL[m]}に掲載がありません`}
                              className={`rounded border px-1.5 py-0.5 text-xs ${on ? color : "border-slate-200 text-slate-300 cursor-not-allowed"}`}
                            >
                              {MALL_LABEL[m]}へ反映
                            </button>
                          );
                        })}
                      </div>
                      {reflectMsg[p.id] && reflectMsgView(reflectMsg[p.id])}
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
        <>
        <div className="rounded border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{selected.size} 件選択中</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-600">一括反映（掲載モールのみ対象）:</span>
          <button onClick={() => reflectBulk("rakuten")} disabled={bulk?.running || bulkTargets("rakuten").length === 0} className="rounded bg-rose-600 px-3 py-1.5 text-white hover:bg-rose-700 disabled:opacity-50">
            楽天へ一括反映（{bulkTargets("rakuten").length}件）
          </button>
          <button onClick={() => reflectBulk("yahoo")} disabled={bulk?.running || bulkTargets("yahoo").length === 0} className="rounded bg-purple-600 px-3 py-1.5 text-white hover:bg-purple-700 disabled:opacity-50">
            Yahooへ一括反映（{bulkTargets("yahoo").length}件）
          </button>
          {bulk && (
            <span className={bulk.running ? "text-blue-700" : "text-slate-600"}>
              {bulk.running ? `反映中… ${bulk.done}/${bulk.total}（${MALL_LABEL[bulk.mall]}）` : bulk.total === 0 ? `${MALL_LABEL[bulk.mall]}掲載の選択商品がありません` : `完了（${MALL_LABEL[bulk.mall]}）: 成功 ${bulk.ok} / 失敗 ${bulk.ng}`}
            </span>
          )}
          {bulk && !bulk.running && bulk.failed.length > 0 && (
            <>
              <button
                onClick={() => reflectBulk(bulk.mall, bulk.failed)}
                disabled={bulk?.running}
                className="rounded border border-red-400 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                失敗した{bulk.failed.length}件だけ再実行
              </button>
              <span className="w-full text-xs text-red-600">
                失敗: {bulk.failed.map((id) => products.find((p) => p.id === id)?.ne_code || id).join(", ")}（各行の理由を確認。ジャンル必須属性の不足は商品編集で補完→再反映。成功済みの商品は再送しません）
              </span>
            </>
          )}
          <span className="text-slate-300">|</span>
          <Link href={`/csv?ids=${Array.from(selected).join(",")}`} className="text-blue-600 hover:underline">選択を一括 CSV 出力</Link>
        </div>
        {/* 一括登録（モールに新規作成/上書き更新）。上の「一括反映」（掲載済みへの変更反映）とは別機能 */}
        <BulkRegisterPanel
          selectedIds={Array.from(selected)}
          onRegistered={(ids, mall) =>
            setProducts((prev) =>
              prev.map((p) =>
                ids.includes(p.id)
                  ? {
                      ...p,
                      extra: {
                        ...p.extra,
                        mall_listed: {
                          ...((p.extra as { mall_listed?: Record<string, boolean> }).mall_listed ?? {}),
                          [mall]: true,
                        },
                      },
                    }
                  : p,
              ),
            )
          }
        />
        </>
      )}
    </div>
  );
}
