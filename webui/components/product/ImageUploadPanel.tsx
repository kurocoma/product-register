"use client";

import { useState, useRef } from "react";

type UploadResult = { label: string; publicUrl: string; at: number };
type Mall = "rakuten" | "yahoo";
type RakutenKind = "main" | "wb";

/** 商品画像を 楽天R-Cabinet / Yahoo追加画像(lib) へアップロードするパネル。
 * 保存済み(productId あり)のときのみ有効。ファイル名はサーバー側が商品コードから確定する。 */
export function ImageUploadPanel({ productId }: { productId?: string }) {
  const [mall, setMall] = useState<Mall>("rakuten");
  const [kind, setKind] = useState<RakutenKind>("main"); // 楽天のみ
  const [index, setIndex] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!productId) {
    return (
      <div className="bg-white border border-slate-200 rounded p-4 text-sm text-slate-500">
        💡 商品を保存すると、画像アップロードが有効になります
      </div>
    );
  }

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("画像ファイルを選択してください");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("productId", productId);
      fd.append("index", String(index));
      fd.append("file", file);
      const endpoint = mall === "yahoo" ? "/api/upload/yahoo" : "/api/upload/rcabinet";
      if (mall === "rakuten") fd.append("kind", kind);
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `アップロード失敗 (HTTP ${res.status})`);
      } else {
        const label = mall === "yahoo" ? `Yahoo: ${json.fileName}` : `楽天: ${json.folder}/${json.name}.jpg`;
        setResults((prev) => [{ label, publicUrl: json.publicUrl, at: Date.now() }, ...prev]);
        if (fileRef.current) fileRef.current.value = "";
        if (!(mall === "rakuten" && kind === "wb")) setIndex((i) => i + 1); // 連続アップ用に枚数を進める
      }
    } catch (e) {
      setError("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setUploading(false);
    }
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
          ...json.uploaded.map((u: { fileName: string; publicUrl: string }) => ({ label: `Yahoo(取込転送): ${u.fileName}`, publicUrl: u.publicUrl, at: Date.now() })),
          ...prev,
        ]);
      }
    } catch (e) {
      setError("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSyncing(false);
    }
  };

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
        {!(mall === "rakuten" && kind === "wb") && (
          <label className="flex items-center gap-1">
            <span className="text-slate-600">何枚目</span>
            <input
              type="number"
              min={1}
              max={20}
              value={index}
              onChange={(e) => setIndex(Math.max(1, Number(e.target.value)))}
              className="w-16 rounded border border-slate-300 px-2 py-1"
            />
          </label>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="block w-full text-sm" />

      <button
        onClick={upload}
        disabled={uploading}
        className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {uploading ? "アップロード中…" : "アップロード"}
      </button>

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
          : "楽天R-Cabinetへアップロードします。1枚目=NEコード、2枚目以降=base_n、白背景=wb-base。"}
        大きい画像は自動で 2MB 以内・JPEG に変換されます。
      </p>

      {error && <p className="text-sm text-red-600">⚠ {error}</p>}

      {results.length > 0 && (
        <div className="space-y-1 border-t border-slate-100 pt-2">
          <div className="text-xs font-semibold text-slate-600">アップロード済み</div>
          {results.map((r) => (
            <div key={r.at} className="flex items-center gap-2 text-xs">
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
