import { NextResponse } from "next/server";
import path from "node:path";
import { mkdir, readFile, writeFile, unlink, stat, readdir, open } from "node:fs/promises";
import { createClient } from "@/lib/supabase/server";
import {
  decodeCsvBytes,
  isNeAutoDownloadTargetKey,
  neAutoDownloadLabel,
  neAutoDownloadTargetDefs,
  mergeCsvPages,
  evaluateMergedPages,
  planPages,
  findProbeMatches,
  runNeMasterDownloadScript,
  NE_SCRIPT_TIMEOUT_MS_DEFAULT,
  NE_PAGE_ITEMS_DEFAULT,
  type NeScriptEvent,
} from "@/lib/ne-master";

export const runtime = "nodejs";
export const maxDuration = 900; // NE ログイン＋3マスタ取得は数分かかる

/** ダウンロード済みCSVの保存先。GET はこの直下の *.csv だけを返す。 */
function downloadDir(): string {
  return process.env.NE_MASTER_DOWNLOAD_DIR
    ? path.resolve(process.env.NE_MASTER_DOWNLOAD_DIR)
    : path.join(process.cwd(), ".ne-master-downloads");
}
function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "ne-master-download.mjs");
}

const SAFE_FILE = /^[A-Za-z0-9._-]+\.csv$/;
/** 対象キーごとに残す結合済みCSVの世代数（それより古いものは実行のたびに掃除する）。 */
const KEEP_GENERATIONS = 5;
const LOCK_FILE = "_running.lock";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// ---------------------------------------------------------------------------
// 同時実行ロック（ブラウザ多重起動＝同一 storage state の奪い合いを防ぐ）
// ---------------------------------------------------------------------------

/**
 * ロックを取る。既に走っていれば null。古い（=クラッシュ残骸）ロックは奪う。
 * ロック解放漏れ（プロセス強制終了など）でこの機能が永久に使えなくなるのを防ぐため、
 * 「スクリプトの全体タイムアウト＋余裕」を過ぎたロックは無条件で奪取する設計にしている
 * （スクリプト自身も DEADLINE_MS で自死するため、その時点で実行中のブラウザは残らない）。
 */
async function acquireLock(dir: string, staleMs: number): Promise<string | null> {
  const lock = path.join(dir, LOCK_FILE);
  try {
    const fh = await open(lock, "wx");
    await fh.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await fh.close();
    return lock;
  } catch {
    try {
      const s = await stat(lock);
      if (Date.now() - s.mtimeMs > staleMs) {
        await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), stolen: true }));
        return lock;
      }
    } catch {
      /* ロックが消えた＝直前に解放された。取り直しは次回に任せる */
    }
    return null;
  }
}

async function releaseLock(lock: string | null) {
  if (lock) await unlink(lock).catch(() => {});
}

/** 対象キーごとに新しい順で KEEP_GENERATIONS 本だけ残し、古い結合済みCSVと probe ログを消す。 */
async function pruneOldGenerations(dir: string, keys: string[]) {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const buckets = new Map<string, { name: string; mtime: number }[]>();
  for (const name of names) {
    if (!name.endsWith(".csv")) continue;
    const key = keys.find((k) => name.startsWith(`${k}-`));
    if (!key) continue;
    try {
      const s = await stat(path.join(dir, name));
      const list = buckets.get(key) ?? [];
      list.push({ name, mtime: s.mtimeMs });
      buckets.set(key, list);
    } catch {
      /* 消えていた */
    }
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => b.mtime - a.mtime);
    for (const old of list.slice(KEEP_GENERATIONS)) await unlink(path.join(dir, old.name)).catch(() => {});
  }
  // probe ログ・ページ別の残骸は1日で掃除
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of names) {
    if (!/^_(probe|page)_/.test(name)) continue;
    try {
      const s = await stat(path.join(dir, name));
      if (s.mtimeMs < dayAgo) await unlink(path.join(dir, name)).catch(() => {});
    } catch {
      /* 消えていた */
    }
  }
}

/** GET /api/masters/auto-download?file=x.csv → 取得済みCSVの中身（既存の取込APIへ流すため） */
export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const file = new URL(req.url).searchParams.get("file");
  if (!file) return NextResponse.json({ ok: false, error: "file を指定してください" }, { status: 400 });

  const name = path.basename(file);
  if (!SAFE_FILE.test(name)) return NextResponse.json({ ok: false, error: "不正なファイル名です" }, { status: 400 });

  const full = path.join(downloadDir(), name);
  try {
    await stat(full);
  } catch {
    return NextResponse.json({ ok: false, error: "ファイルが見つかりません" }, { status: 404 });
  }
  const buf = await readFile(full);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * POST /api/masters/auto-download
 * body: { targets?: ("ne-syohin"|"ne-set"|"ne-himoduke")[], mode?: "download"|"probe", headless?: boolean }
 * 応答: NDJSON ストリーム（進捗をそのまま流し、対象ごとに merged イベントを返す）
 *
 * 安全側の設計:
 *  - 行数不一致・ページ欠落があれば `autoImportBlocked: true` を返し、UI は自動取込しない
 *  - クライアント切断・全体タイムアウトで子プロセス（＋Chromium）を kill
 *  - 同時実行はロックファイルで1本に制限
 */
export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: { targets?: unknown; headless?: unknown; mode?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* 既定値で続行 */
  }
  const mode = body.mode === "probe" ? "probe" : "download";
  const defs = neAutoDownloadTargetDefs();
  const requested = Array.isArray(body.targets) ? body.targets : defs.map((t) => t.key);
  const targets = requested.filter(isNeAutoDownloadTargetKey);
  if (mode === "download" && targets.length === 0) {
    return NextResponse.json({ ok: false, error: "対象（targets）が指定されていません" }, { status: 400 });
  }

  // ヘッドありは開発時のみ（本番サーバーで画面が開くのを防ぐ）
  const allowHeaded = process.env.NE_MASTER_ALLOW_HEADED === "1" || process.env.NODE_ENV !== "production";
  const headless = body.headless === false && allowHeaded ? false : true;

  const timeoutMs = Number(process.env.NE_MASTER_TIMEOUT_MS) || NE_SCRIPT_TIMEOUT_MS_DEFAULT;
  const outDir = downloadDir();
  await mkdir(outDir, { recursive: true });

  // スクリプトは timeoutMs で自死するため、それを一定割合超えたロックはクラッシュ残骸とみなして奪う。
  const lock = await acquireLock(outDir, timeoutMs + Math.min(60_000, Math.ceil(timeoutMs * 0.2)));
  if (!lock) {
    return NextResponse.json(
      { ok: false, error: "NE 自動ダウンロードが既に実行中です。完了を待ってから再実行してください。" },
      { status: 409 },
    );
  }
  await pruneOldGenerations(outDir, defs.map((d) => d.key)).catch(() => {});

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (o: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
        } catch {
          closed = true; // クライアント切断
        }
      };

      send({
        type: "start",
        mode,
        targets,
        message: mode === "probe" ? "NE の画面構成を調べます（ダウンロードはしません）" : `${targets.length}件の対象を取得します`,
      });

      /** ページ別CSV（CP932）を復号→結合→UTF-8で1本に保存し、既存の取込APIへ渡せる形にする。 */
      const merge = async (ev: Extract<NeScriptEvent, { type: "target-done" }>) => {
        const label = neAutoDownloadLabel(ev.key);
        try {
          const texts: string[] = [];
          for (const f of ev.pageFiles) texts.push(decodeCsvBytes(await readFile(f)));
          const merged = mergeCsvPages(texts);
          // 専用ページからの直接ダウンロード（紐づけ表）はページネーションが存在せず1回で全件が
          // 落ちるため、「総件数不明＝要確認」の安全弁（検索一覧の取りこぼし検知）は適用しない。
          // 0行チェック（空CSVの取込防止）は evaluateMergedPages に残る。
          const isDirect = ev.direct === true;
          const expectedPages = isDirect ? 1 : planPages(ev.entries ?? 0, ev.pageItems ?? NE_PAGE_ITEMS_DEFAULT);
          const name = `${ev.key}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.csv`;
          await writeFile(path.join(outDir, name), merged.csv, "utf8");
          for (const f of ev.pageFiles) await unlink(f).catch(() => {});

          // 総件数が読めなかったときは行数照合ができない＝取りこぼしを検出できない。
          // スクリプトの申告に関わらず entries が無ければ必ず「要確認」に倒す（部分データを黙って取込まない）。
          const entriesUnknown = isDirect ? false : ev.entriesUnknown === true || ev.entries == null;
          // セット商品CSVは1件が複数行（構成品ごとの明細）になるため行数照合をしない。
          const rowsMatchEntries = defs.find((d) => d.key === ev.key)?.rowsMatchEntries !== false;
          const verdict = evaluateMergedPages({
            rows: merged.rows,
            entries: ev.entries,
            mergedPages: merged.pages,
            expectedPages,
            entriesUnknown,
            rowsMatchEntries,
          });
          send({
            type: "merged",
            key: ev.key,
            label,
            file: name,
            rows: merged.rows,
            pages: merged.pages,
            expectedPages,
            columns: merged.header.length,
            entries: ev.entries,
            entriesUnknown,
            direct: isDirect,
            warnings: verdict.warnings,
            autoImportBlocked: verdict.autoImportBlocked,
            message: isDirect
              ? `${label}: ${merged.rows}行（専用ページ・全店舗一括）`
              : `${label}: ${merged.rows}行（${merged.pages}ページ結合）${entriesUnknown ? " / 総件数不明" : ""}`,
          });
        } catch (e) {
          send({
            type: "target-error",
            key: ev.key,
            message: `${label} の結合に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      };

      const pending: Promise<void>[] = [];
      try {
        const { code, stderr, timedOut, aborted } = await runNeMasterDownloadScript({
          scriptPath: scriptPath(),
          cwd: process.cwd(),
          targets,
          outDir,
          mode,
          targetDefs: defs,
          headless,
          timeoutMs,
          signal: req.signal,
          onEvent: (ev) => {
            if (ev.type === "target-done") pending.push(merge(ev));
            else if (ev.type === "probe") {
              // どの検索対象・店舗に各マスタがあるかを対象定義に照らして提示する
              const matches = Object.fromEntries(defs.map((d) => [d.key, findProbeMatches(ev.report, d)]));
              send({ type: "probe", report: ev.report, matches, message: ev.message ?? "probe 完了" });
            } else send(ev);
          },
          onLog: (line) => send({ type: "log", message: line }),
        });
        await Promise.all(pending);
        if (timedOut) send({ type: "fatal", message: "全体タイムアウトのため中断しました（NE_MASTER_TIMEOUT_MS で調整できます）" });
        else if (aborted) send({ type: "fatal", message: "クライアント切断のため中断しました" });
        else if (code !== 0 && code !== 2) {
          send({
            type: "fatal",
            message:
              `ダウンロードスクリプトが異常終了しました (exit ${code})。` +
              (stderr ? ` 直近のログ: ${stderr.slice(-500)}` : ""),
          });
        }
        send({ type: "finished", ok: code === 0 && !timedOut && !aborted });
      } catch (e) {
        send({ type: "fatal", message: e instanceof Error ? e.message : String(e) });
        send({ type: "finished", ok: false });
      } finally {
        await releaseLock(lock);
        closed = true;
        try {
          controller.close();
        } catch {
          /* 既に閉じている */
        }
      }
    },
    async cancel() {
      await releaseLock(lock);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
