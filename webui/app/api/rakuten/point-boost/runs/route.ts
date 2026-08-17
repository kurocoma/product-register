import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listResultsForRun, listRuns } from "@/lib/point-boost";

export const runtime = "nodejs";

/** GET = 実行履歴の取得。
 * - ?runId=... : その実行の商品別結果一覧
 * - 指定なし   : 実行履歴（新しい順、?limit= 既定20） */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");

  try {
    if (runId) {
      const results = await listResultsForRun(supabase, user.id, runId);
      return NextResponse.json({ ok: true, results });
    }
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 100) : 20;
    const runs = await listRuns(supabase, user.id, limit);
    return NextResponse.json({ ok: true, runs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
