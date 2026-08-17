import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRakutenApplicationIdFromEnv, getRakutenCredentialsFromEnv } from "@/lib/rakuten";
import { runPointBoost } from "@/lib/point-boost";

export const runtime = "nodejs";
// 検索・RMSとも直列＋1100ms間隔のため件数に比例して時間がかかる（上限50件 ≒ 最大4分程度）
export const maxDuration = 300;

/** 1回のHTTPリクエストで処理する商品数の上限（タイムアウトの安全弁）。
 * 全件処理は定期実行スクリプト（webui/scripts/point_boost_run.mjs）で行う。 */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 40;

/** POST = ポイント変倍チェックの実行。
 * body: { dryRun?: boolean(既定true), limit?: number(既定40・最大50) }
 * - dryRun 既定 true（RMSへの変倍PATCHは dryRun:false を明示したときだけ。安全側既定）。
 * - 実行内容は point_boost_runs / point_boost_results に全件記録される。 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const dryRun: boolean = body?.dryRun !== false; // 既定は dry-run（安全側）
  const rawLimit = Number(body?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const summary = await runPointBoost(
      {
        supabase,
        userId: user.id,
        rmsCred: getRakutenCredentialsFromEnv(),
        applicationId: getRakutenApplicationIdFromEnv(),
      },
      { dryRun, trigger: "manual", limit },
    );
    if (summary.status === "not_configured") {
      return NextResponse.json({ ok: false, error: summary.message, status: summary.status }, { status: 500 });
    }
    if (summary.status === "error") {
      // 部分実行の結果は保存済み。エラー内容と途中結果を返す
      return NextResponse.json(
        { ok: false, error: summary.message, status: summary.status, runId: summary.runId, totals: summary.totals },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      status: summary.status,
      runId: summary.runId,
      dryRun: summary.dryRun,
      message: summary.message,
      totals: summary.totals,
      results: summary.results,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
