"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { searchProducts, dbRowToProductInput } from "@/lib/product/repository";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 画像一括アップロード画面（260711修正依頼-4）。
 * 左: D&D取込＋並び替え / 右: 縦プレビュー。商品選択は任意
 * （検索で選ぶ or 商品コード直接入力で、DB未登録の新規商品コードへの先行アップロードも可）。
 * アップロードは選択モールごとに 1枚ずつ逐次 /api/upload/bulk-image を呼ぶ
 * （Yahoo商品画像が並列不可のため。失敗分は個別に再実行できる）。 */

type Mall = "rakuten" | "yahoo_item" | "yahoo_lib" | "shopify";

const MALL_LABEL: Record<Mall, string> = {
  rakuten: "楽天 R-Cabinet",
  yahoo_item: "Yahoo 商品画像（サムネイル）",
  yahoo_lib: "Yahoo 追加画像",
  shopify: "Shopify",
};

type SelectedProduct = {
  id: string;
  ne_code: string;
  name: string;
  hasShopify: boolean;
};

type Item = {
  key: string;
  file: File;
  previewUrl: string;
};

type UploadResult = {
  itemKey: string;
  index: number;
  mall: Mall;
  ok: boolean;
  fileName?: string;
  error?: string;
};

type CabinetFolder = { folderId: number; folderName: string; folderPath: string };

let itemSeq = 0;

export function BulkImageUploader() {
  // 商品選択（任意）
  const [query, setQuery] = React.useState("");
  const [candidates, setCandidates] = React.useState<SelectedProduct[]>([]);
  const [selected, setSelected] = React.useState<SelectedProduct | null>(null);
  const [codeInput, setCodeInput] = React.useState("");
  const [searching, setSearching] = React.useState(false);

  // アップロード先
  const [malls, setMalls] = React.useState<Record<Mall, boolean>>({
    rakuten: true,
    yahoo_item: false,
    yahoo_lib: false,
    shopify: false,
  });
  const [folders, setFolders] = React.useState<CabinetFolder[]>([]);
  const [rakutenFolderId, setRakutenFolderId] = React.useState<string>("");
  const [yahooLibDir, setYahooLibDir] = React.useState("thum02");

  // 画像リスト
  const [items, setItems] = React.useState<Item[]>([]);
  const dragFrom = React.useRef<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);
  const [dropActive, setDropActive] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // 実行状態
  const [uploading, setUploading] = React.useState(false);
  const [results, setResults] = React.useState<UploadResult[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);

  // 楽天フォルダ一覧（既定 thum02）
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/rcabinet/folders");
        const json = await res.json();
        if (!alive || !json.ok) return;
        setFolders(json.folders);
        const thum = (json.folders as CabinetFolder[]).find((f) => f.folderPath.replace(/^\//, "") === "thum02");
        if (thum) setRakutenFolderId(String(thum.folderId));
      } catch {
        /* 一覧が取れなくても既定フォルダで動作する */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const rows = await searchProducts(createClient(), q);
      setCandidates(
        rows.slice(0, 10).map((r) => {
          const p = dbRowToProductInput(r);
          return {
            id: String((r as { id?: unknown }).id ?? ""),
            ne_code: p.ne_code,
            name: p.display_name || p.product_name || "",
            hasShopify: Boolean(p.shopify_product_id?.trim()),
          };
        }),
      );
    } catch (e) {
      setNotice("商品検索に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSearching(false);
    }
  };

  const effectiveCode = selected?.ne_code || codeInput.trim();

  const addFiles = (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    setItems((cur) => [
      ...cur,
      ...files.map((file) => ({
        key: `img-${++itemSeq}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeItem = (idx: number) => {
    setItems((cur) => {
      URL.revokeObjectURL(cur[idx]?.previewUrl ?? "");
      return cur.filter((_, i) => i !== idx);
    });
  };

  const move = (from: number, to: number) => {
    setItems((cur) => {
      if (from === to || from < 0 || to < 0 || from >= cur.length || to >= cur.length) return cur;
      const next = [...cur];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  };

  const selectedMalls = (Object.keys(malls) as Mall[]).filter((m) => malls[m]);
  const canUpload =
    !uploading && items.length > 0 && selectedMalls.length > 0 && Boolean(effectiveCode) &&
    // Shopify は DB 商品（shopify_product_id あり）が必要
    (!malls.shopify || Boolean(selected?.hasShopify));

  const uploadOne = async (item: Item, index: number, mall: Mall): Promise<UploadResult> => {
    const form = new FormData();
    form.append("file", item.file);
    form.append("mall", mall);
    form.append("index", String(index));
    if (selected) form.append("productId", selected.id);
    else form.append("code", codeInput.trim());
    if (mall === "rakuten" && rakutenFolderId) {
      form.append("rakutenFolderId", rakutenFolderId);
      const f = folders.find((x) => String(x.folderId) === rakutenFolderId);
      if (f) form.append("rakutenFolderPath", f.folderPath);
    }
    if (mall === "yahoo_lib") form.append("yahooLibDir", yahooLibDir.trim() || "thum02");
    try {
      const res = await fetch("/api/upload/bulk-image", { method: "POST", body: form });
      const json = await res.json();
      return { itemKey: item.key, index, mall, ok: Boolean(json.ok), fileName: json.fileName, error: json.error };
    } catch (e) {
      return { itemKey: item.key, index, mall, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const runUpload = async (targets?: UploadResult[]) => {
    setUploading(true);
    setNotice(null);
    try {
      const out: UploadResult[] = targets ? results.filter((r) => r.ok) : [];
      const jobs: { item: Item; index: number; mall: Mall }[] = [];
      if (targets) {
        // 失敗分のみ再実行
        for (const t of targets) {
          const idx = items.findIndex((it) => it.key === t.itemKey);
          if (idx >= 0) jobs.push({ item: items[idx], index: idx + 1, mall: t.mall });
        }
      } else {
        for (const mall of selectedMalls) {
          items.forEach((item, i) => jobs.push({ item, index: i + 1, mall }));
        }
      }
      for (const job of jobs) {
        // 逐次実行（Yahoo商品画像は並列不可・R-Cabinetも安全側で直列）
        out.push(await uploadOne(job.item, job.index, job.mall));
        setResults([...out]);
      }
      const failed = out.filter((r) => !r.ok).length;
      const yahooItemOk = out.some((r) => r.ok && r.mall === "yahoo_item");
      setNotice(
        (failed === 0 ? `全 ${out.length} 件のアップロードが完了しました` : `${failed} 件失敗しました（下の一覧から再実行できます）`) +
          (yahooItemOk ? "。Yahoo 商品画像は未反映状態です — ストアクリエイターPro または反映APIで反映してください" : ""),
      );
    } finally {
      setUploading(false);
    }
  };

  const failedResults = results.filter((r) => !r.ok);

  return (
    <div className="space-y-4">
      {/* 商品選択（任意） */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <h2 className="font-semibold">1. 商品（任意）</h2>
        <p className="text-xs text-slate-500">
          既存商品を検索して選ぶか、商品コードを直接入力してください（新規商品の登録前でも、コードを決めていれば先に画像だけアップロードできます）。
        </p>
        <div className="flex items-center gap-2">
          <Input
            placeholder="商品コード・商品名で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={search} disabled={searching}>
            {searching ? "検索中…" : "🔍 検索"}
          </Button>
        </div>
        {candidates.length > 0 && !selected && (
          <ul className="max-h-40 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100 text-sm">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left hover:bg-blue-50"
                  onClick={() => {
                    setSelected(c);
                    setCandidates([]);
                  }}
                >
                  <span className="font-mono">{c.ne_code}</span>
                  <span className="ml-2 text-slate-500">{c.name.slice(0, 40)}</span>
                  {c.hasShopify && <span className="ml-2 text-[10px] text-emerald-600">Shopify連携あり</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected ? (
          <p className="text-sm">
            選択中: <span className="font-mono font-semibold">{selected.ne_code}</span>
            <span className="ml-2 text-slate-500">{selected.name.slice(0, 40)}</span>
            <button type="button" className="ml-3 text-xs text-blue-600 underline" onClick={() => setSelected(null)}>
              解除
            </button>
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <Label htmlFor="bulk-code" className="mb-0 shrink-0">
              商品コード直接入力:
            </Label>
            <Input
              id="bulk-code"
              placeholder="例: r135-10-1"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              className="max-w-60"
            />
          </div>
        )}
      </section>

      {/* アップロード先 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
        <h2 className="font-semibold">2. アップロード先</h2>
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={malls.rakuten}
              onChange={(e) => setMalls((m) => ({ ...m, rakuten: e.target.checked }))}
            />
            {MALL_LABEL.rakuten}
            <select
              value={rakutenFolderId}
              onChange={(e) => setRakutenFolderId(e.target.value)}
              disabled={!malls.rakuten}
              className="ml-2 rounded border border-slate-300 px-2 py-0.5 text-xs"
              aria-label="楽天フォルダ"
            >
              {folders.map((f) => (
                <option key={f.folderId} value={String(f.folderId)}>
                  {f.folderPath.replace(/^\//, "") || f.folderName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={malls.yahoo_item}
              onChange={(e) => setMalls((m) => ({ ...m, yahoo_item: e.target.checked }))}
            />
            {MALL_LABEL.yahoo_item}
            <span className="text-[11px] text-slate-400">アップロード後に反映が必要</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={malls.yahoo_lib}
              onChange={(e) => setMalls((m) => ({ ...m, yahoo_lib: e.target.checked }))}
            />
            {MALL_LABEL.yahoo_lib}
            <span className="text-xs">ディレクトリ:</span>
            <Input
              value={yahooLibDir}
              onChange={(e) => setYahooLibDir(e.target.value)}
              disabled={!malls.yahoo_lib}
              className="h-7 max-w-36 text-xs"
              aria-label="Yahoo追加画像ディレクトリ"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={malls.shopify}
              onChange={(e) => setMalls((m) => ({ ...m, shopify: e.target.checked }))}
              disabled={!selected?.hasShopify}
            />
            {MALL_LABEL.shopify}
            {!selected?.hasShopify && (
              <span className="text-[11px] text-slate-400">Shopify 連携済みの商品を選択すると使えます</span>
            )}
          </label>
        </div>
        <p className="text-[11px] text-slate-400">
          画像名は商品コードから自動で決まります（1枚目 = 商品コード、2枚目以降 = 連番付き。各モールの既存規約と紐づく名前）。
        </p>
      </section>

      {/* 画像リスト（左）+ プレビュー（右） */}
      <section className="flex gap-4">
        <div className="w-1/2 space-y-2">
          <div
            className={cn(
              "flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-sm",
              dropActive ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white",
            )}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropActive(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <span className="text-slate-500">📥 ここに画像をドラッグ&ドロップ（またはクリックして選択）</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {items.length > 0 && (
            <ul className="space-y-1">
              {items.map((item, idx) => (
                <li
                  key={item.key}
                  className={cn(
                    "flex items-center gap-2 rounded border bg-white p-1.5 text-sm",
                    dragOver === idx ? "border-blue-400 bg-blue-50" : "border-slate-200",
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOver !== idx) setDragOver(idx);
                  }}
                  onDragLeave={() => setDragOver((cur) => (cur === idx ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    if (dragFrom.current != null) move(dragFrom.current, idx);
                    dragFrom.current = null;
                  }}
                >
                  <span
                    draggable
                    onDragStart={() => {
                      dragFrom.current = idx;
                    }}
                    className="cursor-grab select-none px-0.5 text-slate-400"
                    title="ドラッグで並び替え"
                  >
                    ⠿
                  </span>
                  <span className="w-6 text-center font-semibold text-slate-500">{idx + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{item.file.name}</span>
                  <span className="flex gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(idx, idx - 1)}
                      disabled={idx === 0}
                      className="rounded border border-slate-200 px-1 text-xs text-slate-500 disabled:opacity-30"
                      aria-label="上へ"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(idx, idx + 1)}
                      disabled={idx === items.length - 1}
                      className="rounded border border-slate-200 px-1 text-xs text-slate-500 disabled:opacity-30"
                      aria-label="下へ"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="rounded border border-red-200 px-1 text-xs text-red-500"
                      aria-label="削除"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button type="button" onClick={() => runUpload()} disabled={!canUpload}>
              {uploading ? "アップロード中…" : "⬆ 画像をアップロード"}
            </Button>
            {!effectiveCode && items.length > 0 && (
              <span className="text-xs text-amber-600">商品を選択するか商品コードを入力してください</span>
            )}
          </div>

          {notice && <p className="text-xs text-blue-700">{notice}</p>}

          {results.length > 0 && (
            <div className="space-y-1 text-xs">
              {results.map((r, i) => (
                <p key={i} className={r.ok ? "text-emerald-700" : "text-red-600"}>
                  {r.ok ? "✓" : "✕"} {r.index}枚目 → {MALL_LABEL[r.mall]}
                  {r.fileName ? `（${r.fileName}）` : ""}
                  {r.error ? `: ${r.error}` : ""}
                </p>
              ))}
              {failedResults.length > 0 && !uploading && (
                <Button type="button" variant="outline" onClick={() => runUpload(failedResults)}>
                  ↻ 失敗した {failedResults.length} 件を再実行
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 右: 縦プレビュー */}
        <div className="w-1/2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-600">プレビュー（この並び順でアップロードされます）</h3>
          {items.length === 0 ? (
            <p className="text-xs text-slate-400">画像を追加するとここに縦に並びます</p>
          ) : (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <figure key={item.key}>
                  <figcaption className="mb-0.5 text-[11px] text-slate-400">{idx + 1}枚目</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt={`${idx + 1}枚目`} className="w-full rounded border border-slate-100" />
                </figure>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
