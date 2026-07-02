import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { getYahooConfig } from "@/lib/yahoo/auth";
import {
  dryRunRakutenRegister,
  commitRakutenRegister,
} from "@/lib/register/rakuten-register-service";
import {
  dryRunYahooRegister,
  commitYahooRegister,
  reserveYahooPublish,
} from "@/lib/register/yahoo-register-service";
import { toDryRunItemResult, toErrorItemResult, buildBulkResponse } from "@/lib/register/bulk-plan";
import type { BulkItemResult, Mall } from "@/lib/register/types";

export const runtime = "nodejs";

/** 一度に処理できる上限（モールAPI負荷と実行時間の安全弁）。 */
const MAX_BULK = 100;

/** POST = 複数商品の一括モール登録。
 * body: { ids: string[], dryRun?: boolean(既定true), publish?: boolean, submit?: boolean, overwrite?: boolean }
 *       または { action: "submit" }（Yahoo のみ: 登録なしで反映予約だけを行う）
 * - dryRun 既定 true（実登録は dryRun:false を明示したときだけ。安全側既定）。
 * - 商品ごとに try/catch し、1件の失敗で全体を止めない（部分失敗でも HTTP 200 + ok:true）。
 * - モールAPIへは逐次実行（同時多発リクエストを送らない）。
 * - 既存商品の上書きは overwrite を明示したときだけ（既定はスキップ）。
 * - Yahoo の反映(submit)はストア全体単位のため、全件処理後に1回だけ予約する。
 *   フロントが1件ずつ POST する場合は、全件完了後に action:"submit" を1回呼ぶ
 *   （予約の成否を最終件の登録成否に依存させない）。 */
export async function POST(req: Request, { params }: { params: Promise<{ mall: string }> }) {
  const { mall: mallParam } = await params;
  if (mallParam !== "rakuten" && mallParam !== "yahoo") {
    return NextResponse.json({ ok: false, error: "対応していないモールです（rakuten / yahoo）" }, { status: 400 });
  }
  const mall: Mall = mallParam;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // 反映予約のみ（action:"submit"）: 一括登録ループの完了後にフロントが1回だけ呼ぶ薄い口。
  // 予約の成否を最終商品の登録成否から切り離す（先行して成功した商品の反映漏れを防ぐ）。
  if (body?.action === "submit") {
    if (mall !== "yahoo") {
      return NextResponse.json(
        { ok: false, error: "反映予約(action: submit)はYahooのみ対応しています" },
        { status: 400 },
      );
    }
    const submitCfg = getYahooConfig();
    if (!submitCfg) {
      return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });
    }
    const s = await reserveYahooPublish(submitCfg);
    return NextResponse.json({ ok: true, mall, submitted: s.ok, submitMessage: s.message });
  }

  const ids: string[] = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "対象商品(ids)が指定されていません" }, { status: 400 });
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json(
      { ok: false, error: `一度に処理できるのは ${MAX_BULK} 件までです（${ids.length} 件選択中）` },
      { status: 400 },
    );
  }
  const dryRun: boolean = body?.dryRun !== false; // 既定は dry-run（安全側）
  const publish: boolean = body?.publish === true;
  const submit: boolean = body?.submit === true;
  const overwrite: boolean = body?.overwrite === true;

  const cred = mall === "rakuten" ? getRakutenCredentialsFromEnv() : null;
  const cfg = mall === "yahoo" ? getYahooConfig() : null;
  if (mall === "rakuten" && !cred) {
    return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });
  }
  if (mall === "yahoo" && !cfg) {
    return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });
  }

  const results: BulkItemResult[] = [];
  // 逐次実行: モールAPIへ同時多発リクエストを送らない（Promise.all で並列化しない）
  for (const id of ids) {
    try {
      const row = await getProduct(supabase, id);
      if (!row) {
        results.push(toErrorItemResult(id, "商品が見つかりません"));
        continue;
      }
      const product = dbRowToProductInput(row);
      const info = { ne_code: product.ne_code, product_name: product.product_name };

      // dry-run 判定（commit でも上書きゲート・必須検証のため必ず先に行う）
      const plan =
        mall === "rakuten"
          ? await dryRunRakutenRegister(cred!, product)
          : await dryRunYahooRegister(cfg!, product);
      const key = plan.mall === "rakuten" ? plan.manageNumber : plan.itemCode;
      const itemPlan = { key, exists: plan.exists, valid: plan.valid, missing: plan.missing };

      if (dryRun || !plan.valid) {
        results.push(toDryRunItemResult(id, info, itemPlan));
        continue;
      }

      // commit: 既存商品の上書きは明示フラグがない限りスキップ（安全側既定）
      if (plan.exists && !overwrite) {
        results.push({
          id,
          ...info,
          ok: false,
          valid: true,
          willOverwrite: true,
          action: "skip",
          key,
          error: "既存商品があるためスキップしました（「既存商品を上書きする」を有効にすると更新されます）",
        });
        continue;
      }

      const commit =
        mall === "rakuten"
          ? await commitRakutenRegister(supabase, cred!, product, id, { publish })
          : await commitYahooRegister(supabase, cfg!, product, id, { publish, submit: false });
      if (!commit.ok) {
        results.push({
          id,
          ...info,
          ok: false,
          valid: commit.kind !== "invalid",
          willOverwrite: plan.exists,
          key,
          ...(commit.kind === "invalid" ? { valid: false, missing: commit.missing } : {}),
          error: commit.error,
        });
        continue;
      }
      results.push({
        id,
        ...info,
        ok: true,
        valid: true,
        willOverwrite: plan.exists,
        action: plan.exists ? "update" : "create",
        key,
        registered: true,
      });
    } catch (e) {
      // 1件の失敗（DB取得・変換・想定外例外）で全体を止めない
      results.push(toErrorItemResult(id, e instanceof Error ? e.message : String(e)));
    }
  }

  const response = buildBulkResponse(mall, dryRun, results);

  // Yahoo の反映(submit): ストア全体単位のため全件処理後に1回だけ予約する
  if (mall === "yahoo" && !dryRun && submit) {
    if (results.some((r) => r.registered === true)) {
      const s = await reserveYahooPublish(cfg!);
      response.submitted = s.ok;
      response.submitMessage = s.message;
    } else {
      response.submitted = false;
      response.submitMessage = "登録に成功した商品がないため反映を予約しませんでした";
    }
  }

  return NextResponse.json(response);
}
