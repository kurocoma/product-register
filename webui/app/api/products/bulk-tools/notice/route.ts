import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseManageNumbers } from "@/lib/migrate";
import {
  buildNoticeAppendPlans,
  buildNoticeRemovePlans,
  executeBulkPlans,
  summarizeBulk,
  NOTICE_FIELDS,
  NOTICE_FIELD_LABELS,
  type BulkExecItemResult,
  type BulkPlanItem,
  type NoticeBlockRef,
  type NoticeField,
} from "@/lib/bulk-tools";
import { makeBulkDbDeps, prepareMallClients } from "../deps";

export const runtime = "nodejs";

const MAX_ITEMS = 50;

/** POST = お知らせ一括追記/解除（機能2）。
 *
 * body: {
 *   mode: "append" | "remove"
 *   manageNumbers: string | string[]   // 管理番号リスト（改行/カンマ/CSV1列）
 *   // append 時:
 *   body: string                       // お知らせ本文（HTML可）
 *   position: "head" | "tail"          // 冒頭 / 末尾
 *   fields: string[]                   // sale_description_pc / description_pc / description_sp
 *   // remove 時:
 *   selection?: { productId, field, id }[]  // 検出済みマーカーから削除する対象
 *   dryRun?: boolean                   // 既定 true
 *   payloadHash?: string               // commit 必須
 *   yahooReserve?: boolean
 *   delayMs?: number
 * }
 *
 * 追記は HTML コメント＋本文ハッシュID のマーカーで囲む（スマホ説明文もマーカー可。
 * 2026-07-28 実測でコメントが pc/sp とも patch/読み戻しで保持されることを確認済み）。
 * 解除はマーカーごと除去して原文へ戻す。DB更新後、楽天は patch（salesDescription 含む）、
 * Yahoo は説明文変更が editItem 更新経路（caption ビルダー値）で反映される。
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: {
    mode?: unknown;
    manageNumbers?: unknown;
    body?: unknown;
    position?: unknown;
    fields?: unknown;
    selection?: unknown;
    dryRun?: unknown;
    payloadHash?: unknown;
    yahooReserve?: unknown;
    delayMs?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* 下の検証で弾く */
  }

  const mode = body.mode === "remove" ? "remove" : body.mode === "append" ? "append" : null;
  if (!mode) {
    return NextResponse.json({ ok: false, error: "mode は append / remove を指定してください" }, { status: 400 });
  }
  const rawManage = body.manageNumbers;
  if (typeof rawManage !== "string" && !Array.isArray(rawManage)) {
    return NextResponse.json(
      { ok: false, error: "manageNumbers（管理番号の配列／改行テキスト／CSV1列）を指定してください" },
      { status: 400 },
    );
  }
  const { valid, invalid, duplicatesRemoved } = parseManageNumbers(rawManage as string | string[]);
  if (valid.length === 0) {
    return NextResponse.json({ ok: false, error: "有効な管理番号がありません", invalid }, { status: 400 });
  }
  if (valid.length > MAX_ITEMS) {
    return NextResponse.json(
      { ok: false, error: `対象が多すぎます(${valid.length}件)。${MAX_ITEMS}件以下に分割してください` },
      { status: 400 },
    );
  }
  const dryRun = body.dryRun !== false;
  const yahooReserve = body.yahooReserve === true;
  const delayMs = typeof body.delayMs === "number" && body.delayMs >= 0 ? body.delayMs : 300;

  const db = makeBulkDbDeps(supabase, user.id);

  try {
    if (mode === "append") {
      const noticeBody = typeof body.body === "string" ? body.body.trim() : "";
      if (!noticeBody) {
        return NextResponse.json({ ok: false, error: "お知らせ本文を入力してください" }, { status: 400 });
      }
      const position = body.position === "tail" ? "tail" : body.position === "head" ? "head" : null;
      if (!position) {
        return NextResponse.json({ ok: false, error: "position は head（冒頭）/ tail（末尾）を指定してください" }, { status: 400 });
      }
      const fields = (Array.isArray(body.fields) ? body.fields : []).filter((f): f is NoticeField =>
        (NOTICE_FIELDS as readonly string[]).includes(String(f)),
      );
      if (fields.length === 0) {
        return NextResponse.json(
          { ok: false, error: `対象フィールド（${Object.values(NOTICE_FIELD_LABELS).join(" / ")}）を1つ以上選択してください` },
          { status: 400 },
        );
      }
      const { noticeId, plans, payloadHash } = await buildNoticeAppendPlans(db, valid, {
        body: noticeBody,
        position,
        fields,
      });
      if (dryRun) {
        return NextResponse.json({
          ok: true,
          dryRun: true,
          payloadHash,
          noticeId,
          position,
          fields,
          results: plans.map(toPlanResponse),
          summary: summarizeBulk(plans),
          invalid,
          duplicatesRemoved,
        });
      }
      const commit = await commitPlans(db, plans, payloadHash, body.payloadHash, {
        kind: "bulk_notice_append",
        yahooReserve,
        delayMs,
        detail: { notice_id: noticeId, position, fields },
      });
      if ("errorResponse" in commit) return commit.errorResponse;
      return NextResponse.json({
        ok: true,
        dryRun: false,
        payloadHash,
        noticeId,
        results: commit.results.map(toCommitResponse),
        summary: summarizeBulk(commit.results),
        reserve: commit.reserve,
        invalid,
        duplicatesRemoved,
      });
    }

    // mode === "remove"
    const selection: NoticeBlockRef[] = [];
    if (Array.isArray(body.selection)) {
      for (const s of body.selection as { productId?: unknown; field?: unknown; id?: unknown }[]) {
        if (
          typeof s?.productId === "string" &&
          typeof s?.id === "string" &&
          (NOTICE_FIELDS as readonly string[]).includes(String(s?.field))
        ) {
          selection.push({ productId: s.productId, field: s.field as NoticeField, id: s.id });
        }
      }
    }
    const { found, plans, payloadHash } = await buildNoticeRemovePlans(db, valid, selection);
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        payloadHash,
        found: found.map((f) => ({ ...f, body: truncate(f.body, 200) })),
        results: plans.map(toPlanResponse),
        summary: summarizeBulk(plans),
        invalid,
        duplicatesRemoved,
      });
    }
    const commit = await commitPlans(db, plans, payloadHash, body.payloadHash, {
      kind: "bulk_notice_remove",
      yahooReserve,
      delayMs,
      detail: { selection },
    });
    if ("errorResponse" in commit) return commit.errorResponse;
    return NextResponse.json({
      ok: true,
      dryRun: false,
      payloadHash,
      results: commit.results.map(toCommitResponse),
      summary: summarizeBulk(commit.results),
      reserve: commit.reserve,
      invalid,
      duplicatesRemoved,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

async function commitPlans(
  db: ReturnType<typeof makeBulkDbDeps>,
  plans: BulkPlanItem[],
  payloadHash: string,
  givenHash: unknown,
  opts: { kind: string; yahooReserve: boolean; delayMs: number; detail: Record<string, unknown> },
) {
  if (typeof givenHash !== "string" || givenHash !== payloadHash) {
    return {
      errorResponse: NextResponse.json(
        { ok: false, error: "プレビュー後に商品データまたは入力が変わりました。もう一度プレビューしてください" },
        { status: 409 },
      ),
    };
  }
  const clients = await prepareMallClients(plans);
  if (!clients.ok) {
    return {
      errorResponse: NextResponse.json({ ok: false, error: clients.error }, { status: clients.status }),
    };
  }
  return executeBulkPlans({ ...db, rakuten: clients.rakuten, yahoo: clients.yahoo }, plans, opts);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** プレビュー応答（説明文の全文は返さず、フィールドごとの長さ変化に要約する）。 */
function toPlanResponse(p: BulkPlanItem) {
  return {
    key: p.key,
    productId: p.productId,
    status: p.status,
    reason: p.reason,
    title: p.title,
    fields: p.changes.map((c) => ({
      field: c.field,
      label: NOTICE_FIELD_LABELS[c.field as NoticeField] ?? c.field,
      beforeLength: String(c.before ?? "").length,
      afterLength: String(c.after ?? "").length,
    })),
    warnings: p.warnings,
  };
}

function toCommitResponse(r: BulkExecItemResult) {
  return {
    key: r.key,
    productId: r.productId,
    status: r.status,
    error: r.error,
    warnings: r.warnings,
    rakuten: r.rakuten ? { ok: r.rakuten.ok, updated: r.rakuten.updated, message: r.rakuten.message } : null,
    yahoo: r.yahoo ? { ok: r.yahoo.ok, updated: r.yahoo.updated, message: r.yahoo.message } : null,
  };
}
