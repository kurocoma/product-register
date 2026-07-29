"use client";

import { useState } from "react";
// 対象一覧は lib 正本から取る（UI で作り直さない）。
// barrel（@/lib/ne-master）は repository 経由で Supabase サーバークライアントを掴むため、
// クライアントコンポーネントからは純ロジックのモジュールを直接 import する。
import { NE_AUTO_DOWNLOAD_TARGETS } from "@/lib/ne-master/auto-download";

type SourceDef = { key: string; source: string; mall?: string; label: string; hint: string };

const SOURCES: SourceDef[] = [
  { key: "ne-syohin", source: "ne-syohin", label: "NE 商品マスタ（単品）", hint: "syohin_basic*.csv（売価・税率・在庫）" },
  { key: "ne-set", source: "ne-set", label: "NE セット商品マスタ", hint: "set_syohin*.csv（セット構成・セット売価）" },
  { key: "ne-himoduke", source: "ne-himoduke", label: "NE 紐づけ表", hint: "himoduke*.csv（在庫連携・代表商品コード）" },
  { key: "excel-master", source: "excel-master", label: "Excel 商品マスタ", hint: "from-excel/excel_syohin_master.csv（JAN・原価・カテゴリ）" },
  { key: "excel-discon", source: "excel-discon", label: "Excel 終売品マスタ", hint: "from-excel/excel_discon.csv（終売フラグ）" },
  { key: "excel-mall-rakuten", source: "excel-mall", mall: "rakuten", label: "Excel 商品コード一覧 楽天", hint: "from-excel/excel_mall_rakuten.csv" },
  { key: "excel-mall-yahoo", source: "excel-mall", mall: "yahoo", label: "Excel 商品コード一覧 Yahoo", hint: "from-excel/excel_mall_yahoo.csv" },
  { key: "excel-mall-amazon", source: "excel-mall", mall: "amazon", label: "Excel 商品コード一覧 amazon", hint: "from-excel/excel_mall_amazon.csv" },
  { key: "excel-mall-shimanoya", source: "excel-mall", mall: "shimanoya", label: "Excel しまのや商品コード一覧", hint: "from-excel/excel_mall_shimanoya.csv" },
];

/** 取込結果(JSON)を人間向けの短い文字列にする。 */
function summarize(j: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof j.inserted === "number") parts.push(`新規 ${j.inserted}`);
  if (typeof j.updated === "number") parts.push(`更新 ${j.updated}`);
  if (j.items && typeof j.items === "object") {
    const it = j.items as { inserted?: number; updated?: number };
    parts.push(`商品 新規${it.inserted ?? 0}/更新${it.updated ?? 0}`);
  }
  if (typeof j.composition === "number") parts.push(`構成 ${j.composition}`);
  if (typeof j.upserted === "number") parts.push(`登録 ${j.upserted}`);
  if (typeof j.unmatched === "number" && j.unmatched > 0) parts.push(`未解決 ${j.unmatched}`);
  return parts.join(" / ") || "完了";
}

function SourceUploader({ def }: { def: SourceDef }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const run = async () => {
    if (!file) {
      setErr("CSVファイルを選択してください");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const q = def.mall ? `?mall=${def.mall}` : "";
      const res = await fetch(`/api/masters/import/${def.source}${q}`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setErr(j.error || `取込失敗 (HTTP ${res.status})`);
        return;
      }
      setMsg("✓ " + summarize(j));
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded p-3 space-y-2 bg-white">
      <div className="font-medium text-sm">{def.label}</div>
      <div className="text-xs text-slate-500">{def.hint}</div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <button
          onClick={run}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "取込中…" : "取込"}
        </button>
      </div>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">⚠ {err}</p>}
    </div>
  );
}

/** 自動ダウンロードの対象は NE の3マスタ（key は既存の取込ソースキーと同じ）。正本は lib。 */
const AUTO_TARGETS = NE_AUTO_DOWNLOAD_TARGETS;

type AutoResult = {
  label: string;
  file: string;
  rows: number;
  pages: number;
  expectedPages: number;
  warnings: string[];
  /** 行数不一致・ページ欠落があるとき true。自動取込を止めて明示確認を求める。 */
  blocked: boolean;
  /** NE 側の総件数を読み取れなかった（行数照合ができていない）。 */
  entriesUnknown?: boolean;
  /** 専用ページからの直接ダウンロード（紐づけ表。ページ結合なし・全店舗一括）。 */
  direct?: boolean;
  importing?: boolean;
  importMsg?: string;
  importErr?: string;
};

type ProbeMatch = { optionText: string; tenpoLabel: string; fileName: string; panelHeading: string };
type ProbeFile = { fileName: string; panelHeading: string };
type ProbeTenpo = { value: string; label: string; downloadFiles?: ProbeFile[]; error?: string };
type ProbeSearchTarget = {
  optionText: string;
  containerId: string | null;
  entries: number | null;
  countText: string;
  pagination?: { found: boolean; links: { tag: string; text: string; className: string }[] };
  perTenpo?: ProbeTenpo[];
  error?: string;
};
type ProbeState = { searchTargets: ProbeSearchTarget[]; matches: Record<string, ProbeMatch[]> };

/** NDJSON ストリームを1行ずつ読んでコールバックする。 */
async function readNdjson(res: Response, onEvent: (ev: Record<string, unknown>) => void) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        /* 途中の非JSON行は無視 */
      }
    }
  }
}

/** NE にログインして3マスタのCSVを自動取得し、そのまま既存の取込パイプラインへ流すパネル。 */
function NeAutoDownloadPanel() {
  const [picked, setPicked] = useState<Record<string, boolean>>(
    Object.fromEntries(AUTO_TARGETS.map((t) => [t.key, true])),
  );
  const [autoImport, setAutoImport] = useState(true);
  const [running, setRunning] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, AutoResult>>({});
  const [err, setErr] = useState<string | null>(null);

  const addLog = (line: string) => setLogs((prev) => [...prev.slice(-199), line]);

  /** 取得済みCSVを既存の /api/masters/import/[source] へアップロードする（取込ロジックは既存のまま）。 */
  const importDownloaded = async (key: string, file: string) => {
    setResults((prev) => ({ ...prev, [key]: { ...prev[key], importing: true, importErr: undefined } }));
    try {
      const fileRes = await fetch(`/api/masters/auto-download?file=${encodeURIComponent(file)}`);
      if (!fileRes.ok) throw new Error(`取得済みCSVを読めませんでした (HTTP ${fileRes.status})`);
      const blob = await fileRes.blob();
      const fd = new FormData();
      fd.append("file", new File([blob], file, { type: "text/csv" }));
      const res = await fetch(`/api/masters/import/${key}`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || `取込失敗 (HTTP ${res.status})`);
      setResults((prev) => ({ ...prev, [key]: { ...prev[key], importing: false, importMsg: summarize(j) } }));
      addLog(`✓ ${key}: 取込完了（${summarize(j)}）`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setResults((prev) => ({ ...prev, [key]: { ...prev[key], importing: false, importErr: message } }));
      addLog(`⚠ ${key}: 取込失敗（${message}）`);
    }
  };

  const run = async () => {
    const targets = AUTO_TARGETS.filter((t) => picked[t.key]).map((t) => t.key);
    if (targets.length === 0) {
      setErr("取得する対象を1つ以上選んでください");
      return;
    }
    setRunning(true);
    setErr(null);
    setLogs([]);
    setResults({});
    // 警告なし（＝件数・ページ数が一致）のものだけ自動取込する
    const importable: { key: string; file: string }[] = [];
    try {
      const res = await fetch("/api/masters/auto-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        setErr(j?.error || `起動に失敗しました (HTTP ${res.status})`);
        return;
      }
      await readNdjson(res, (ev) => {
        const message = typeof ev.message === "string" ? ev.message : "";
        if (ev.type === "merged") {
          const key = String(ev.key);
          const warnings = Array.isArray(ev.warnings) ? (ev.warnings as string[]) : [];
          const blocked = ev.autoImportBlocked === true || warnings.length > 0;
          setResults((prev) => ({
            ...prev,
            [key]: {
              label: String(ev.label ?? key),
              file: String(ev.file),
              rows: Number(ev.rows ?? 0),
              pages: Number(ev.pages ?? 1),
              expectedPages: Number(ev.expectedPages ?? 0),
              warnings,
              blocked,
              entriesUnknown: ev.entriesUnknown === true,
              direct: ev.direct === true,
            },
          }));
          if (!blocked) importable.push({ key, file: String(ev.file) });
          addLog(blocked ? `⚠ ${message}（要確認のため自動取込しません）` : `✓ ${message}`);
        } else if (ev.type === "target-error" || ev.type === "fatal") {
          addLog(`⚠ ${message}`);
          if (ev.type === "fatal") setErr(message);
        } else if (message) {
          addLog(message);
        }
      });
      if (autoImport) for (const d of importable) await importDownloaded(d.key, d.file);
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  };

  /** NE の画面構成を調べる（ダウンロードしない）。紐づけ表がどの検索対象にあるかの確定に使う。 */
  const runProbe = async () => {
    setProbing(true);
    setErr(null);
    setLogs([]);
    setProbe(null);
    try {
      const res = await fetch("/api/masters/auto-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "probe" }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        setErr(j?.error || `起動に失敗しました (HTTP ${res.status})`);
        return;
      }
      await readNdjson(res, (ev) => {
        const message = typeof ev.message === "string" ? ev.message : "";
        if (ev.type === "probe") {
          const report = ev.report as { searchTargets?: ProbeSearchTarget[] } | undefined;
          setProbe({
            searchTargets: report?.searchTargets ?? [],
            matches: (ev.matches as Record<string, ProbeMatch[]>) ?? {},
          });
          addLog(`✓ ${message}`);
        } else if (ev.type === "fatal") {
          addLog(`⚠ ${message}`);
          setErr(message);
        } else if (message) {
          addLog(message);
        }
      });
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded p-3 space-y-3 bg-white">
      <div className="text-xs text-slate-500">
        NE にログインして「商品管理」の詳細検索から商品・セットの2マスタを取得します。1000件を超える場合は2ページ目以降も取得して結合します。
        紐づけ表は専用ページ（設定＞商品＞商品コード紐づけ）から全店舗一括でダウンロードします。
        件数やページ数が合わないときは取りこぼし・重複の疑いがあるため、自動取込を止めて確認を求めます。
        資格情報は環境変数（<code>NEXT_ENGINE_LOGIN_ID</code> / <code>NEXT_ENGINE_PASSWORD</code>）から読み込みます。
        取得に失敗するときは「NEの画面構成を調べる（診断）」で画面変更を確認できます。
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {AUTO_TARGETS.map((t) => (
          <label key={t.key} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={!!picked[t.key]}
              disabled={running}
              onChange={(e) => setPicked((p) => ({ ...p, [t.key]: e.target.checked }))}
            />
            {t.label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={running || probing}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {running ? "取得中…（数分かかります）" : "NEから自動ダウンロード"}
        </button>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={autoImport}
            disabled={running}
            onChange={(e) => setAutoImport(e.target.checked)}
          />
          ダウンロード後そのまま取込む（警告が出た対象は取込みません）
        </label>
        <button
          onClick={runProbe}
          disabled={running || probing}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="NE にログインして、検索対象3種×店舗ごとにどのCSVが落とせるかだけを調べます（ダウンロードはしません）"
        >
          {probing ? "調査中…" : "NEの画面構成を調べる（診断）"}
        </button>
      </div>

      {err && <p className="text-sm text-red-600">⚠ {err}</p>}

      {probe && (
        <div className="rounded border border-slate-300 bg-slate-50 p-2 text-sm space-y-2">
          <div className="font-medium">診断結果（どの検索対象にどのCSVがあるか）</div>
          {probe.searchTargets.map((st) => (
            <div key={st.optionText} className="space-y-0.5">
              <div className="text-xs font-medium text-slate-700">
                {st.optionText} — {st.countText || (st.entries != null ? `${st.entries}件` : "件数不明")} / container=
                {st.containerId ?? "不明"}
              </div>
              {st.error && <p className="text-xs text-red-600">⚠ {st.error}</p>}
              {(st.perTenpo ?? []).map((t) => (
                <p key={`${st.optionText}-${t.value}`} className="text-xs text-slate-600 break-all">
                  ・{t.label || t.value}: {(t.downloadFiles ?? []).map((f) => f.fileName).join(", ") || "CSVなし"}
                  {t.error ? `（${t.error}）` : ""}
                </p>
              ))}
              {st.pagination && (
                <p className="text-xs text-slate-500 break-all">
                  ・ページャ: {st.pagination.links.map((l) => `${l.tag}"${l.text}"`).join(" ") || "リンクなし（1ページ）"}
                </p>
              )}
            </div>
          ))}
          <div className="space-y-0.5 border-t border-slate-200 pt-1">
            {AUTO_TARGETS.map((t) => {
              if (t.direct) {
                return (
                  <p key={t.key} className="text-xs text-green-700">
                    ✓ {t.label}: 専用ページ（設定＞商品＞商品コード紐づけ）から直接取得します（診断の対象外）
                  </p>
                );
              }
              const m = probe.matches?.[t.key] ?? [];
              return (
                <p key={t.key} className={`text-xs ${m.length ? "text-green-700" : "text-amber-700"}`}>
                  {m.length ? "✓" : "⚠"} {t.label}:{" "}
                  {m.length
                    ? m.map((x) => `${x.optionText} / ${x.tenpoLabel} → ${x.fileName}`).join(" , ")
                    : "見つかりませんでした"}
                </p>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">
            見つからない対象があるときは、上の一覧から正しい <code>data-file-name</code> を選び、環境変数
            <code>NE_MASTER_SYOHIN_FILE</code> / <code>_SEARCH_TARGET</code> / <code>_CONTAINER</code>
            （対象ごとに SYOHIN / SET / HIMODUKE）で指定してください。紐づけ表の専用ページが変わったときは
            <code>NE_MASTER_HIMODUKE_DIRECT_URL</code> / <code>NE_MASTER_HIMODUKE_DIRECT_BUTTON</code> で上書きできます。
          </p>
        </div>
      )}

      {Object.entries(results).map(([key, r]) => (
        <div
          key={key}
          className={`rounded border p-2 text-sm space-y-1 ${r.blocked ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}
        >
          <div className="font-medium">
            {r.label}: {r.rows}行{r.direct ? "（専用ページ・全店舗一括）" : ` / ${r.pages}ページ結合`}
            {!r.direct && r.expectedPages > 0 && r.pages !== r.expectedPages ? `（必要 ${r.expectedPages}ページ）` : ""}
          </div>
          <div className="text-xs text-slate-500 break-all">{r.file}</div>
          {r.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700">
              ⚠ {w}
            </p>
          ))}
          {r.blocked && !r.importMsg && (
            <p className="text-xs text-amber-800">
              取りこぼし・重複の可能性があるため<strong>自動取込を止めました</strong>。
              CSVの中身を確認したうえで、問題なければ下のボタンで取込んでください。
            </p>
          )}
          {r.entriesUnknown && !r.importMsg && (
            <p className="text-xs text-amber-800">
              NE 側の総件数（<code>data-entries</code> / 「全N件中…」表記）を読み取れなかったため、
              <strong>行数の照合ができていません</strong>。1000件を超える対象では後半ページの取りこぼしが起こりえます。
              CSVの行数が想定どおりかを確認してください（NE の画面構成が変わった可能性があるため「診断」も有効です）。
            </p>
          )}
          {r.importMsg && <p className="text-green-700">✓ 取込 {r.importMsg}</p>}
          {r.importErr && <p className="text-red-600">⚠ 取込失敗: {r.importErr}</p>}
          {!r.importMsg && (
            <button
              onClick={() => {
                if (r.blocked && !confirm(`${r.label} は警告があります。\n\n${r.warnings.join("\n")}\n\nそれでも取込みますか？`)) return;
                void importDownloaded(key, r.file);
              }}
              disabled={r.importing}
              className={`rounded px-2 py-1 text-xs font-medium text-white disabled:opacity-50 ${
                r.blocked ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {r.importing ? "取込中…" : r.blocked ? "警告を承知で取込む" : "このCSVを取込む"}
            </button>
          )}
        </div>
      ))}

      {logs.length > 0 && (
        <pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600 whitespace-pre-wrap">
          {logs.join("\n")}
        </pre>
      )}
    </div>
  );
}

export function MasterImportPanel() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="font-semibold">① NE から自動ダウンロード（NEにログインして取得）</div>
        <NeAutoDownloadPanel />
      </div>
      <div className="space-y-2">
        <div className="font-semibold">② NE マスタ（CSVをそのまま）</div>
        <div className="grid gap-2 md:grid-cols-3">
          {SOURCES.filter((s) => s.key.startsWith("ne-")).map((s) => (
            <SourceUploader key={s.key} def={s} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="font-semibold">③ Excel（先に <code>python tools/excel_to_csv.py</code> でCSV化）</div>
        <div className="grid gap-2 md:grid-cols-3">
          {SOURCES.filter((s) => s.key.startsWith("excel-")).map((s) => (
            <SourceUploader key={s.key} def={s} />
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        取込はソースごとに独立して何度でも可能（冪等マージ）。CP932/UTF-8 自動判定。
        Yahoo/Amazon は商品番号列が無いため一部「未解決」になることがあります（紐づけ漏れの手掛かり）。
      </p>
    </div>
  );
}
