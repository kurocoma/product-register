"use client";

import { useRef, useState } from "react";
import { MAX_IMAGE_SLOTS, planUploadIndices } from "@/lib/image/upload-plan";
import { notifyWhiteBgImageUploaded } from "./ProductForm";

type UploadResult = { label: string; publicUrl: string; key: string };
type Mall = "rakuten" | "yahoo";
type RakutenKind = "main" | "wb";

type ItemStatus = "pending" | "uploading" | "ok" | "error";
type SelectedItem = {
  id: number;
  file: File;
  status: ItemStatus;
  /** アップロード実行時に確定した番号（楽天wb は null）。失敗後の再実行でも同じ番号を使う。 */
  assigned?: number | null;
  error?: string;
};

/** 商品画像を 楽天R-Cabinet / Yahoo追加画像(lib) へアップロードするパネル。
 * 複数ファイルの一括アップロード対応: 「何枚目」の開始番号から各ファイルへ番号を自動割当し
 * （楽天wbは番号なし）、既存の1枚用アップロードAPIを1件ずつ順番に呼ぶ。
 * 保存済み(productId あり)のときのみ有効。ファイル名はサーバー側が商品コードから確定する。
 * 楽天 白背景(wb01)のアップロード成功時は、notifyWhiteBgImageUploaded 経由でフォームの
 * 「白背景画像」欄(white_bg_image_url) へ自動反映する（楽天 whiteBgImage の反映元。商品につき1枚）。 */
export function ImageUploadPanel({ productId }: { productId?: string }) {
  const [mall, setMall] = useState<Mall>("rakuten");
  const [kind, setKind] = useState<RakutenKind>("main"); // 楽天のみ
  const [index, setIndex] = useState(1);
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const idSeq = useRef(0);

  if (!productId) {
    return (
      <div className="bg-white border border-slate-200 rounded p-4 text-sm text-slate-500">
        💡 商品を保存すると、画像アップロードが有効になります
      </div>
    );
  }

  // 楽天wb(白背景)は番号を割り当てない（従来どおり index を送らず番号も進めない）
  const indexed = !(mall === "rakuten" && kind === "wb");

  // 番号の割当計画: 番号が未確定（前回失敗の持ち越しでない）ファイルへ開始番号から連番を振る
  const unassignedIds = items
    .filter((it) => it.status !== "ok" && it.assigned === undefined)
    .map((it) => it.id);
  const plan = planUploadIndices(unassignedIds.length, index, { indexed });
  const slotById = new Map(unassignedIds.map((id, i) => [id, i] as const));

  // 表示・実行用: 各ファイルの番号（確定済み > 今回の計画 > 範囲外）
  const rows = items.map((it) => {
    if (it.status === "ok" || it.assigned !== undefined) {
      return { it, num: it.assigned ?? null, overflow: false };
    }
    if (!indexed) return { it, num: null, overflow: false };
    const s = slotById.get(it.id) ?? Number.MAX_SAFE_INTEGER;
    return s < plan.indices.length
      ? { it, num: plan.indices[s], overflow: false }
      : { it, num: null, overflow: true }; // 20枠を超える分はアップロード対象から外す
  });
  const uploadTargets = rows.filter((r) => r.it.status !== "ok" && !r.overflow);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    // 選択済みリストへ追記する（置き換えない）
    setItems((prev) => [
      ...prev,
      ...images.map((file) => {
        idSeq.current += 1;
        return { id: idSeq.current, file, status: "pending" as const };
      }),
    ]);
    setSummary(null);
    setError(null);
  };

  const removeItem = (id: number) => setItems((prev) => prev.filter((it) => it.id !== id));
  const clearDone = () => setItems((prev) => prev.filter((it) => it.status !== "ok"));

  const uploadOne = async (item: SelectedItem, num: number | null) => {
    const fd = new FormData();
    fd.append("productId", productId);
    if (num !== null) fd.append("index", String(num));
    fd.append("file", item.file);
    const endpoint = mall === "yahoo" ? "/api/upload/yahoo" : "/api/upload/rcabinet";
    if (mall === "rakuten") fd.append("kind", kind);
    const res = await fetch(endpoint, { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error || `アップロード失敗 (HTTP ${res.status})`);
    }
    return json as { fileName?: string; folder?: string; name?: string; publicUrl: string };
  };

  const uploadAll = async () => {
    if (uploadTargets.length === 0) {
      setError("画像ファイルを選択してください");
      return;
    }
    setUploading(true);
    setError(null);
    setSummary(null);
    let okCount = 0;
    let ngCount = 0;
    let lastAssigned: number | null = null;
    let lastWbUrl: string | null = null; // 楽天wb成功分の公開URL（白背景画像欄への自動反映用）

    // 既存の1枚用アップロード経路を1件ずつ順番に呼ぶ（並列にしない）
    for (const { it, num } of uploadTargets) {
      if (num !== null) lastAssigned = num;
      setItems((prev) =>
        prev.map((x) =>
          x.id === it.id ? { ...x, status: "uploading", assigned: num, error: undefined } : x,
        ),
      );
      try {
        const json = await uploadOne(it, num);
        const label =
          mall === "yahoo" ? `Yahoo: ${json.fileName}` : `楽天: ${json.folder}/${json.name}.jpg`;
        setResults((prev) => [
          { label, publicUrl: json.publicUrl, key: `${Date.now()}-${it.id}` },
          ...prev,
        ]);
        setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, status: "ok" } : x)));
        okCount += 1;
        if (mall === "rakuten" && kind === "wb") lastWbUrl = json.publicUrl;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setItems((prev) =>
          prev.map((x) => (x.id === it.id ? { ...x, status: "error", error: msg } : x)),
        );
        ngCount += 1;
      }
    }

    if (indexed && lastAssigned !== null) setIndex(lastAssigned + 1); // 次の開始番号を進める

    // 白背景(wb)成功時はフォームの「白背景画像」欄へ自動反映する（複数成功時は最後の1枚。
    // 白背景は商品につき1枚のため）。フォーム未マウント時は手動貼り付けの案内を出す。
    let wbNote = "";
    if (lastWbUrl) {
      wbNote = notifyWhiteBgImageUploaded(lastWbUrl)
        ? "。白背景画像URLをフォームの「白背景画像」欄へ自動反映しました"
        : "。白背景画像URLの自動反映ができませんでした（下のURLをフォームの「白背景画像」欄へ貼り付けてください）";
    }
    setSummary(
      `成功 ${okCount}枚 / 失敗 ${ngCount}枚` +
        (ngCount > 0 ? "（失敗分はリストに残っています。原因を直して再アップロードできます）" : "") +
        wbNote,
    );
    if (fileRef.current) fileRef.current.value = "";
    setUploading(false);
  };

  // 取込んだ実画像URL(image_url_N)を Yahoo追加画像(lib)へ転送する（楽天取込商品をYahooに出す準備）。
  const syncFromImport = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/upload/yahoo-sync/${productId}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        const detail = json.failed?.length ? json.failed.map((f: { error: string }) => f.error).join(" / ") : "";
        setError(json.error || detail || `転送失敗 (HTTP ${res.status})`);
      }
      if (Array.isArray(json.uploaded) && json.uploaded.length > 0) {
        setResults((prev) => [
          ...json.uploaded.map((u: { fileName: string; publicUrl: string }, i: number) => ({
            label: `Yahoo(取込転送): ${u.fileName}`,
            publicUrl: u.publicUrl,
            key: `sync-${Date.now()}-${i}`,
          })),
          ...prev,
        ]);
      }
    } catch (e) {
      setError("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSyncing(false);
    }
  };

  const hasDone = items.some((it) => it.status === "ok");

  return (
    <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <div className="font-semibold">🖼 画像アップロード</div>

      {/* モール選択タブ */}
      <div className="flex gap-1 text-sm">
        <MallTab active={mall === "rakuten"} onClick={() => setMall("rakuten")} color="red">
          楽天 (R-Cabinet)
        </MallTab>
        <MallTab active={mall === "yahoo"} onClick={() => setMall("yahoo")} color="rose">
          Yahoo (追加画像)
        </MallTab>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {mall === "rakuten" && (
          <label className="flex items-center gap-1">
            <span className="text-slate-600">種別</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as RakutenKind)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="main">商品画像 (thum02)</option>
              <option value="wb">白背景 (wb01)</option>
            </select>
          </label>
        )}
        {indexed && (
          <label className="flex items-center gap-1">
            <span className="text-slate-600">何枚目から</span>
            <input
              type="number"
              min={1}
              max={MAX_IMAGE_SLOTS}
              value={index}
              onChange={(e) => setIndex(Math.max(1, Number(e.target.value)))}
              className="w-16 rounded border border-slate-300 px-2 py-1"
            />
            <span className="text-xs text-slate-400">（複数選択時は1枚ずつ自動で+1）</span>
          </label>
        )}
      </div>

      {/* ファイル選択 + ドラッグ&ドロップ */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className="rounded border-2 border-dashed border-slate-300 p-3"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ""; // 同じファイルの再選択もできるようにする
          }}
          className="block w-full text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">
          💡 複数まとめて選択、またはここに画像をドラッグ&ドロップで追記できます
        </p>
      </div>

      {/* 選択済みリスト（番号割当 + 成否表示） */}
      {items.length > 0 && (
        <div className="space-y-1 rounded border border-slate-200 p-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-600">選択中のファイル</div>
            {hasDone && (
              <button
                type="button"
                onClick={clearDone}
                className="text-xs text-slate-500 hover:underline"
              >
                成功分をリストから外す
              </button>
            )}
          </div>
          {rows.map(({ it, num, overflow }) => (
            <div key={it.id} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-xs">
              <span
                className={`inline-block w-14 shrink-0 rounded px-1 py-0.5 text-center font-mono ${
                  overflow ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                }`}
              >
                {overflow ? "範囲外" : num !== null ? `${num}枚目` : "番号なし"}
              </span>
              <span className="min-w-0 flex-1 truncate" title={it.file.name}>
                {it.file.name}
              </span>
              <span className="shrink-0">
                {it.status === "uploading" && <span className="text-slate-500">…送信中</span>}
                {it.status === "ok" && <span className="text-green-700">✓ 成功</span>}
                {it.status === "error" && <span className="text-red-600">✗ 失敗</span>}
              </span>
              {it.status !== "uploading" && (
                <button
                  type="button"
                  onClick={() => removeItem(it.id)}
                  className="shrink-0 text-slate-400 hover:text-red-600"
                  aria-label="リストから外す"
                >
                  ×
                </button>
              )}
              {it.status === "error" && it.error && (
                <span className="basis-full break-all pl-16 text-red-600">⚠ {it.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {plan.overflow > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          ⚠ 画像枠は{MAX_IMAGE_SLOTS}までです。{plan.overflow}枚が範囲外になります
          （範囲外の分はアップロードされません。開始番号を調整するか枚数を減らしてください）
        </p>
      )}

      <button
        onClick={uploadAll}
        disabled={uploading || uploadTargets.length === 0}
        className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {uploading
          ? "アップロード中…"
          : uploadTargets.length > 1
            ? `${uploadTargets.length}枚を順番にアップロード`
            : "アップロード"}
      </button>

      {summary && <p className="text-sm text-slate-700">{summary}</p>}

      {mall === "yahoo" && (
        <div className="rounded border border-rose-200 bg-rose-50/50 p-2 space-y-1">
          <button
            onClick={syncFromImport}
            disabled={syncing}
            className="rounded border border-rose-400 text-rose-700 px-3 py-1.5 text-sm font-medium hover:bg-rose-100 disabled:opacity-50"
          >
            {syncing ? "転送中…" : "⤴ 取込画像をYahoo libへ転送"}
          </button>
          <p className="text-xs text-slate-500">
            楽天等から取込んだ商品の画像(image_url)をYahoo追加画像(lib)へコピーします。
            ファイルが手元になくてもOK。転送後に「Yahooへ登録」が通ります（it-14091 対策）。
          </p>
        </div>
      )}

      <p className="text-xs text-slate-500">
        {mall === "yahoo"
          ? "Yahoo追加画像(lib)へアップロードします。ファイル名=商品コード(1枚目=NEコード、2枚目以降=NEコード_n)。公開URL: lib/okimarumarket/…"
          : "楽天R-Cabinetへアップロードします。1枚目=NEコード、2枚目以降=base_n、白背景=wb-base。白背景はアップロード成功時にフォームの「白背景画像」欄へ自動反映されます。"}
        大きい画像は自動で 2MB 以内・JPEG に変換されます。
      </p>

      {error && <p className="text-sm text-red-600">⚠ {error}</p>}

      {results.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2">
          <div className="text-xs font-semibold text-slate-600">アップロード済み</div>
          {results.map((r) => (
            <div key={r.key} className="flex items-center gap-2 text-xs">
              <span className="text-green-700">✓</span>
              <span className="font-mono">{r.label}</span>
              <a href={r.publicUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                開く
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MallTab({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color: "red" | "rose";
  children: React.ReactNode;
}) {
  const activeCls = color === "red" ? "border-red-500 text-red-700" : "border-rose-500 text-rose-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-t border-b-2 px-2 py-1 font-medium transition-colors ${
        active ? activeCls : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
