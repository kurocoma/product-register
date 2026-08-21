"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpLink } from "@/components/help/HelpLink";
import type { PointBoostSettings, ProductResult, RunTotals } from "@/lib/point-boost/types";

type SettingsResponse =
  | { ok: true; settings: PointBoostSettings; hasApplicationId: boolean; hasAccessKey: boolean; hasRmsCred: boolean }
  | { ok: false; error: string };

type RunRow = {
  id: string;
  trigger: string;
  dry_run: boolean;
  status: string;
  started_at: string;
  finished_at: string | null;
  total_targets: number;
  boosted_count: number;
  cleared_count: number;
  unchanged_count: number;
  no_competitor_count: number;
  skipped_count: number;
  error_count: number;
  error: string;
};

type ResultRow = ProductResult & { id: string; run_id: string; created_at: string };

type RunResponse =
  | { ok: true; runId: string | null; dryRun: boolean; message: string; totals: RunTotals; results: ProductResult[] }
  | { ok: false; error: string };

const ACTION_LABEL: Record<ProductResult["action"], { label: string; cls: string }> = {
  boosted: { label: "変倍", cls: "border-blue-200 bg-blue-50 text-blue-800" },
  cleared: { label: "解除", cls: "border-purple-200 bg-purple-50 text-purple-800" },
  unchanged: { label: "変更なし", cls: "border-slate-200 bg-slate-50 text-slate-600" },
  no_competitor: { label: "競合なし", cls: "border-slate-200 bg-slate-50 text-slate-500" },
  skipped: { label: "対象外", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  error: { label: "エラー", cls: "border-red-200 bg-red-50 text-red-700" },
};

export function PointBoostPanel() {
  const [settings, setSettings] = useState<PointBoostSettings | null>(null);
  const [hasApplicationId, setHasApplicationId] = useState(true);
  const [hasAccessKey, setHasAccessKey] = useState(true);
  const [hasRmsCred, setHasRmsCred] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<false | "dry" | "commit">(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[] | ProductResult[]>([]);

  const refreshRuns = useCallback(async () => {
    const res = await fetch("/api/rakuten/point-boost/runs", { cache: "no-store" });
    const body = (await res.json()) as { ok: boolean; runs?: RunRow[]; error?: string };
    if (body.ok && body.runs) setRuns(body.runs);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/rakuten/point-boost/settings", { cache: "no-store" });
        const body = (await res.json()) as SettingsResponse;
        if (!active) return;
        if (body.ok) {
          setSettings(body.settings);
          setHasApplicationId(body.hasApplicationId);
          setHasAccessKey(body.hasAccessKey);
          setHasRmsCred(body.hasRmsCred);
        } else {
          setError(body.error);
        }
        await refreshRuns();
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshRuns]);

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/rakuten/point-boost/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) throw new Error(body.error ?? "保存に失敗しました");
      setMessage("設定を保存しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const run = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm("RMS にポイント変倍を実際に反映します。よろしいですか？")) return;
    setRunning(dryRun ? "dry" : "commit");
    setError(null);
    setMessage(null);
    setSelectedRunId(null);
    setResults([]);
    try {
      const res = await fetch("/api/rakuten/point-boost/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, limit: 25 }),
      });
      const body = (await res.json()) as RunResponse;
      if (!body.ok) throw new Error(body.error);
      setMessage(body.message);
      setResults(body.results);
      setSelectedRunId(body.runId);
      await refreshRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refreshRuns();
    } finally {
      setRunning(false);
    }
  };

  const openRun = async (runId: string) => {
    setSelectedRunId(runId);
    setResults([]);
    try {
      const res = await fetch(`/api/rakuten/point-boost/runs?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
      const body = (await res.json()) as { ok: boolean; results?: ResultRow[]; error?: string };
      if (!body.ok) throw new Error(body.error ?? "結果の取得に失敗しました");
      setResults(body.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">ポイント変倍</h1>
          <HelpLink anchor="screen-point-boost" />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          楽天市場で同一商品を最安値順に検索して競合店のポイント倍率をチェックし、自店の商品別ポイント変倍を競合より高く設定します（上乗せ分のポイント原資は店舗負担です）。
        </p>
      </div>

      {(!hasApplicationId || !hasAccessKey) && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠ 楽天ウェブサービスの認証情報が未設定のため、競合検索を実行できません。
          <a href="https://webservice.rakuten.co.jp/" target="_blank" rel="noreferrer" className="mx-1 text-blue-700 underline">
            楽天ウェブサービス
          </a>
          でアプリ登録（無料）し、アプリ情報の Application ID と Access Key を
          <code className="mx-1 rounded bg-amber-100 px-1">webui/.env.local</code> に
          <code className="mx-1 rounded bg-amber-100 px-1">RAKUTEN_APPLICATION_ID=...</code> と
          <code className="mx-1 rounded bg-amber-100 px-1">RAKUTEN_WEBSERVICE_ACCESS_KEY=...</code> として追加して再起動してください。
          {hasApplicationId && !hasAccessKey && (
            <span className="mt-1 block">（Application ID は設定済みです。不足しているのは Access Key のみです）</span>
          )}
        </div>
      )}
      {!hasRmsCred && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠ 楽天 ESA 認証情報（RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY）が未設定のため、変倍の照会・反映ができません。
        </div>
      )}
      {error && <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">⚠ {error}</div>}
      {message && <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

      {/* 設定 */}
      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold text-slate-900">設定</h2>
        {!settings ? (
          <p className="text-sm text-slate-500">読み込み中…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              <span>
                自動実行を有効にする
                <span className="ml-2 text-xs text-slate-500">
                  （タスクスケジューラからの1日2回の実行で実際に変倍します。無効中は手動実行のみ）
                </span>
              </span>
            </label>
            <div className="flex flex-wrap gap-4">
              <NumberField
                label="上乗せ倍率(+n)"
                value={settings.plus_rate}
                min={1}
                max={5}
                onChange={(v) => setSettings({ ...settings, plus_rate: v })}
              />
              <NumberField
                label="上限倍率"
                value={settings.max_rate}
                min={1}
                max={20}
                onChange={(v) => setSettings({ ...settings, max_rate: v })}
              />
              <NumberField
                label="比較する最安値上位店舗数"
                value={settings.compare_top_n}
                min={1}
                max={10}
                onChange={(v) => setSettings({ ...settings, compare_top_n: v })}
              />
              <NumberField
                label="適用日数"
                value={settings.campaign_days}
                min={1}
                max={60}
                onChange={(v) => setSettings({ ...settings, campaign_days: v })}
              />
            </div>
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={saving}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中…" : "設定を保存"}
            </button>
          </div>
        )}
      </section>

      {/* 手動実行 */}
      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold text-slate-900">手動実行</h2>
        <p className="mb-3 text-xs text-slate-500">
          1回の手動実行で処理するのは最大25件です（楽天APIの間隔制限のため数分かかります）。全件は定期実行（1日2回）が処理します。
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={running !== false || !hasApplicationId || !hasAccessKey || !hasRmsCred}
            className="rounded border border-blue-300 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {running === "dry" ? "確認中…" : "dry-run（照会のみ・反映しない）"}
          </button>
          <button
            type="button"
            onClick={() => void run(false)}
            disabled={running !== false || !hasApplicationId || !hasAccessKey || !hasRmsCred}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running === "commit" ? "実行中…" : "今すぐ実行（RMSへ反映）"}
          </button>
        </div>
      </section>

      {/* 実行履歴 */}
      <section className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">実行履歴</div>
        {runs.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">まだ実行がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">開始</th>
                  <th className="px-2 py-2">種別</th>
                  <th className="px-2 py-2">状態</th>
                  <th className="px-2 py-2 text-right">対象</th>
                  <th className="px-2 py-2 text-right">変倍</th>
                  <th className="px-2 py-2 text-right">解除</th>
                  <th className="px-2 py-2 text-right">変更なし</th>
                  <th className="px-2 py-2 text-right">競合なし</th>
                  <th className="px-2 py-2 text-right">エラー</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id} className={selectedRunId === r.id ? "bg-blue-50/50" : undefined}>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(r.started_at)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {r.trigger === "scheduled" ? "自動" : "手動"}
                      {r.dry_run ? "（dry-run）" : ""}
                    </td>
                    <td className="px-2 py-2">
                      {r.status === "done" ? "完了" : r.status === "running" ? "実行中" : `エラー: ${r.error}`}
                    </td>
                    <td className="px-2 py-2 text-right">{r.total_targets}</td>
                    <td className="px-2 py-2 text-right">{r.boosted_count}</td>
                    <td className="px-2 py-2 text-right">{r.cleared_count}</td>
                    <td className="px-2 py-2 text-right">{r.unchanged_count}</td>
                    <td className="px-2 py-2 text-right">{r.no_competitor_count}</td>
                    <td className="px-2 py-2 text-right">{r.error_count}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => void openRun(r.id)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        結果を見る
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 商品別結果 */}
      {results.length > 0 && (
        <section className="rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
            商品別結果（{results.length}件）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">商品</th>
                  <th className="px-2 py-2">検索キーワード</th>
                  <th className="px-2 py-2 text-right">競合数</th>
                  <th className="px-2 py-2 text-right">競合最大</th>
                  <th className="px-2 py-2 text-right">現在→目標</th>
                  <th className="px-2 py-2">結果</th>
                  <th className="px-2 py-2">詳細</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {results.map((r, i) => {
                  const a = ACTION_LABEL[r.action];
                  return (
                    <tr key={"id" in r ? (r as ResultRow).id : `${r.ne_code}-${i}`}>
                      <td className="px-4 py-2">
                        <div className="font-mono text-xs text-slate-500">{r.ne_code}</div>
                        <div className="max-w-[220px] truncate">{r.product_name}</div>
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-mono text-xs">{r.search_keyword || "—"}</span>
                        {r.keyword_type === "name" && (
                          <span className="ml-1 text-xs text-slate-400">(商品名)</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">{r.matched_count}</td>
                      <td className="px-2 py-2 text-right">
                        {r.competitor_max_rate !== null ? `${r.competitor_max_rate}倍` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {r.current_rate !== null ? `${r.current_rate}倍` : "1倍"} → {r.target_rate !== null ? `${r.target_rate}倍` : "—"}
                        {r.capped && <span className="ml-1 text-xs text-amber-600">上限</span>}
                      </td>
                      <td className="px-2 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${a.cls}`}>{a.label}</span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="max-w-[320px] text-xs text-slate-600">{r.detail}</div>
                        {r.competitors.length > 0 && (
                          <details className="mt-1 text-xs text-slate-500">
                            <summary className="cursor-pointer">競合 {r.competitors.length} 店</summary>
                            <ul className="mt-1 space-y-0.5">
                              {r.competitors.map((c) => (
                                <li key={c.shopCode}>
                                  <a href={c.itemUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                    {c.shopName}
                                  </a>
                                  ：{c.itemPrice.toLocaleString()}円 / {c.pointRate}倍
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-slate-600">{props.label}</span>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-20 rounded border border-slate-300 px-2 py-1"
      />
    </label>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
