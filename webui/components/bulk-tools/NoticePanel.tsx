"use client";

import { useState } from "react";
import type { BulkSummary, BulkToolStatus, ReserveOutcome } from "@/lib/bulk-tools/types";
import type { NoticeField } from "@/lib/bulk-tools/notice";
import {
  BulkResultBanner,
  MallOutcomeCell,
  ReserveBanner,
  STATUS_CLASS,
  STATUS_LABEL,
  YahooReserveCheckbox,
} from "./common";

type MallOutcome = { ok: boolean; updated: number; message: string } | null;

type ItemResponse = {
  key: string;
  productId: string;
  status: BulkToolStatus;
  reason?: string;
  error?: string;
  title?: string;
  fields?: { field: string; label: string; beforeLength: number; afterLength: number }[];
  warnings?: string[];
  rakuten?: MallOutcome;
  yahoo?: MallOutcome;
};

type FoundBlock = {
  productId: string;
  key: string;
  title: string;
  field: NoticeField;
  fieldLabel: string;
  id: string;
  body: string;
  selected: boolean;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  payloadHash?: string;
  noticeId?: string;
  found?: FoundBlock[];
  results?: ItemResponse[];
  summary?: BulkSummary;
  reserve?: ReserveOutcome;
  invalid?: { raw: string; reason: string }[];
  duplicatesRemoved?: number;
};

const FIELD_OPTIONS: { field: NoticeField; label: string }[] = [
  { field: "sale_description_pc", label: "楽天PC販売説明文" },
  { field: "description_pc", label: "PC商品説明文（Yahooにも反映）" },
  { field: "description_sp", label: "スマホ説明文" },
];

const TABS = [
  { id: "append", label: "📢 追記" },
  { id: "remove", label: "🧹 解除（マーカー削除）" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** お知らせ一括追記（機能2）: 本文＋位置＋対象フィールド＋管理番号リスト → プレビュー → 実行。
 * 追記はマーカー（HTMLコメント＋本文ハッシュID）で囲み、解除タブでマーカーごと一括削除できる。 */
export function NoticePanel() {
  const [tab, setTab] = useState<TabId>("append");
  const [manageText, setManageText] = useState("");
  const [noticeBody, setNoticeBody] = useState("");
  const [position, setPosition] = useState<"head" | "tail">("head");
  const [fields, setFields] = useState<NoticeField[]>(["sale_description_pc", "description_pc", "description_sp"]);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [yahooReserve, setYahooReserve] = useState(true);
  const [busy, setBusy] = useState<null | "dry" | "commit">(null);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const selectedRefs = () =>
    Object.entries(selection)
      .filter(([, v]) => v)
      .map(([k]) => {
        const [productId, field, id] = k.split("|");
        return { productId, field, id };
      });

  const inputKey = JSON.stringify(
    tab === "append" ? { tab, manageText, noticeBody, position, fields } : { tab, manageText, selection },
  );
  const previewStale = data?.dryRun === true && previewKey !== inputKey;
  const canCommit =
    data?.dryRun === true && !previewStale && !!data.payloadHash && (data.summary?.applicable ?? 0) > 0;

  const switchTab = (t: TabId) => {
    setTab(t);
    setData(null);
    setErr(null);
    setPreviewKey(null);
  };

  const run = async (mode: "dry" | "commit") => {
    if (!manageText.trim()) {
      setErr("管理番号を入力してください（改行/カンマ/CSV1列）");
      return;
    }
    if (tab === "append" && !noticeBody.trim()) {
      setErr("お知らせ本文を入力してください");
      return;
    }
    if (tab === "append" && fields.length === 0) {
      setErr("対象フィールドを1つ以上選択してください");
      return;
    }
    if (mode === "commit") {
      if (!canCommit || !data?.payloadHash) return;
      const s = data.summary;
      const okConfirm = window.confirm(
        tab === "append"
          ? `お知らせを追記します（対象 ${s?.applicable ?? 0} 商品・${position === "head" ? "冒頭" : "末尾"}）。\n` +
              "アプリDB更新 → 楽天patch → Yahoo editItem の順に反映します。よろしいですか？"
          : `選択したお知らせマーカーを削除します（対象 ${s?.applicable ?? 0} 商品）。\n` +
              "アプリDB更新 → 楽天patch → Yahoo editItem の順に反映します。よろしいですか？",
      );
      if (!okConfirm) return;
    }
    setBusy(mode);
    setErr(null);
    try {
      const res = await fetch("/api/products/bulk-tools/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: tab,
          manageNumbers: manageText,
          ...(tab === "append"
            ? { body: noticeBody, position, fields }
            : { selection: selectedRefs() }),
          dryRun: mode === "dry",
          payloadHash: mode === "commit" ? data?.payloadHash : undefined,
          yahooReserve,
        }),
      });
      const j = (await res.json()) as ApiResponse;
      if (!res.ok || !j.ok) {
        setErr(j.error || `処理失敗 (HTTP ${res.status})`);
        if (res.status === 409) setData(null);
        return;
      }
      setData(j);
      if (mode === "dry") {
        setPreviewKey(inputKey);
        if (tab === "remove" && j.found && Object.keys(selection).length === 0) {
          // 初回検出時は全ブロックを選択状態にする。選択が変わるためプレビューは stale になり、
          // 「もう一度プレビュー」の案内が出る（hash は選択込みで再計算される）。
          const all: Record<string, boolean> = {};
          for (const f of j.found) all[`${f.productId}|${f.field}|${f.id}`] = true;
          if (Object.keys(all).length > 0) setSelection(all);
        }
      }
    } catch (e) {
      setErr("通信エラー: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => switchTab(t.id)}
            className={
              tab === t.id
                ? "rounded-t border border-b-0 border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700"
                : "rounded-t px-4 py-2 text-sm text-slate-500 hover:text-slate-800"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded p-4 space-y-3">
        {tab === "append" ? (
          <>
            <p className="text-xs text-slate-500">
              お知らせ本文（HTML可）を選択した説明文フィールドの<strong>冒頭または末尾</strong>へ一括追記します。
              追記部分は目印マーカー（HTMLコメント）で囲まれ、「解除」タブからマーカーごと一括削除できます。
              空欄の説明文には追記しません（自動生成などの既存運用を保持）。
              スマホ説明文はHTMLタグ制限があるため、使えないタグは反映時に自動変換・エラーになる場合があります。
            </p>
            <textarea
              value={noticeBody}
              onChange={(e) => setNoticeBody(e.target.value)}
              placeholder={"例:\n<p>【重要】8/11〜8/15は夏季休業のため出荷をお休みします。</p>"}
              disabled={busy !== null}
              rows={4}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono disabled:opacity-50"
            />
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
              <span className="text-xs text-slate-500">追記位置:</span>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={position === "head"}
                  onChange={() => setPosition("head")}
                  disabled={busy !== null}
                />
                冒頭
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={position === "tail"}
                  onChange={() => setPosition("tail")}
                  disabled={busy !== null}
                />
                末尾
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
              <span className="text-xs text-slate-500">対象フィールド:</span>
              {FIELD_OPTIONS.map((o) => (
                <label key={o.field} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={fields.includes(o.field)}
                    onChange={(e) =>
                      setFields((prev) =>
                        e.target.checked ? [...prev, o.field] : prev.filter((f) => f !== o.field),
                      )
                    }
                    disabled={busy !== null}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500">
            管理番号リストの商品からお知らせマーカーを検出して一覧表示します。
            削除するブロックを選択して（既定は全選択）プレビュー → 実行すると、マーカーごと除去して原文へ戻し、
            楽天・Yahoo にも反映します。
          </p>
        )}

        <textarea
          value={manageText}
          onChange={(e) => setManageText(e.target.value)}
          placeholder={"対象の管理番号:\nr117-1\nr3001-1\n（改行/カンマ/CSV1列で複数可）"}
          disabled={busy !== null}
          rows={4}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-mono disabled:opacity-50"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => run("dry")}
            disabled={busy !== null}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "dry" ? "プレビュー中…" : tab === "append" ? "プレビュー（書き込みなし）" : "検出・プレビュー（書き込みなし）"}
          </button>
          <button
            type="button"
            onClick={() => run("commit")}
            disabled={busy !== null || !canCommit}
            title={canCommit ? "プレビューで表示した内容をそのまま実行します" : "先にプレビューしてください（入力を変えた場合は再プレビュー）"}
            className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy === "commit" ? "実行中…" : tab === "append" ? "実行（追記＋モール反映）" : "実行（削除＋モール反映）"}
          </button>
          {previewStale && (
            <span className="text-xs text-amber-700">⚠ 入力が変わりました。実行前にもう一度プレビューしてください</span>
          )}
        </div>
        <YahooReserveCheckbox checked={yahooReserve} onChange={setYahooReserve} disabled={busy !== null} />

        {busy && (
          <p className="text-sm text-slate-600" role="status" aria-live="polite">
            ⏳ {busy === "dry" ? "プレビュー中…" : "実行中…"}（商品数により数十秒〜数分かかることがあります）
          </p>
        )}

        {err && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            ❌ 失敗しました：{err}
          </div>
        )}

        {data?.summary && (
          <BulkResultBanner
            dryRun={data.dryRun === true}
            summary={data.summary}
            previewMessage={
              tab === "append"
                ? "下の表で追記されるフィールドを確認し、問題なければ「実行」してください。"
                : "検出されたマーカーの選択を確認し、問題なければ「実行」してください。"
            }
            doneMessage={
              tab === "append"
                ? "お知らせの追記とモール反映が完了しました。解除は「解除」タブから行えます。"
                : "お知らせマーカーの削除とモール反映が完了しました。"
            }
          />
        )}
        <ReserveBanner reserve={data?.reserve} />

        {!!data?.invalid?.length && (
          <div className="text-xs text-amber-700">
            不正な入力（無視）:{" "}
            <span className="font-mono">{data.invalid.map((iv) => `${iv.raw}(${iv.reason})`).join(", ")}</span>
          </div>
        )}

        {tab === "remove" && !!data?.found?.length && (
          <div className="overflow-x-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-2 py-2">削除</th>
                  <th className="px-2 py-2">管理番号</th>
                  <th className="px-2 py-2">フィールド</th>
                  <th className="px-2 py-2">マーカーID</th>
                  <th className="px-2 py-2">本文（先頭200字）</th>
                </tr>
              </thead>
              <tbody>
                {data.found.map((f) => {
                  const k = `${f.productId}|${f.field}|${f.id}`;
                  return (
                    <tr key={k} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          checked={selection[k] ?? false}
                          onChange={(e) => setSelection((prev) => ({ ...prev, [k]: e.target.checked }))}
                          disabled={busy !== null}
                        />
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {f.key}
                        <div className="text-[10px] text-slate-400">{f.title}</div>
                      </td>
                      <td className="px-2 py-1">{f.fieldLabel}</td>
                      <td className="px-2 py-1 font-mono">{f.id}</td>
                      <td className="px-2 py-1 text-slate-600 whitespace-pre-wrap break-all">{f.body}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!!data?.results?.length && (
          <div className="overflow-x-auto border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-2 py-2">管理番号</th>
                  <th className="px-2 py-2">区分</th>
                  <th className="px-2 py-2">商品名</th>
                  <th className="px-2 py-2">変更フィールド</th>
                  <th className="px-2 py-2">楽天</th>
                  <th className="px-2 py-2">Yahoo</th>
                  <th className="px-2 py-2">理由 / 警告</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.productId || r.key} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2 font-mono">{r.key}</td>
                    <td className={`px-2 py-2 font-medium ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</td>
                    <td className="px-2 py-2 text-slate-600">{r.title ?? ""}</td>
                    <td className="px-2 py-2">
                      {(r.fields ?? []).map((f, i) => (
                        <div key={i} className="whitespace-nowrap">
                          {f.label}
                          <span className="text-slate-500">（{f.beforeLength} → {f.afterLength}字）</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-2 py-2"><MallOutcomeCell outcome={r.rakuten} /></td>
                    <td className="px-2 py-2"><MallOutcomeCell outcome={r.yahoo} /></td>
                    <td className="px-2 py-2 text-slate-600">
                      {r.reason ?? r.error ?? ""}
                      {(r.warnings ?? []).map((w, i) => (
                        <div key={i} className="text-amber-700">⚠ {w}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
