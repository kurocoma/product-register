import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { getYahooConfig } from "@/lib/yahoo/auth";
import {
  dryRunYahooRegister,
  commitYahooRegister,
} from "@/lib/register/yahoo-register-service";

export const runtime = "nodejs";

/** GET = dry-run プレビュー（書き込みなし）。送信予定の editItem パラメータと、
 * 既存商品の有無（更新になるか新規になるか）を返す。
 * ロジックは lib/register/yahoo-register-service.ts に集約（一括登録と共用）。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cfg = getYahooConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  return NextResponse.json(await dryRunYahooRegister(cfg, product));
}

/** POST = commit（editItem 実行）。body: { submit?: boolean, publish?: boolean, stockQuantity?: number, forceDisplay?: string }
 * - 既存商品があれば forUpdate（display を送らず公開状態維持）。
 * - 安全登録が既定: display=0(非表示)。publish=true で公開(display=1)。forceDisplay 明示指定が最優先（テスト用）。
 * - submit=true なら反映（reservePublish = ストア全体単位）まで行う。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cfg = getYahooConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });

  const body = await req.json().catch(() => ({}));

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const result = await commitYahooRegister(supabase, cfg, product, id, {
    submit: body?.submit === true,
    publish: body?.publish === true,
    stockQuantity: typeof body?.stockQuantity === "number" ? body.stockQuantity : undefined,
    forceDisplay: typeof body?.forceDisplay === "string" ? body.forceDisplay : undefined,
  });
  if (!result.ok) {
    if (result.kind === "invalid") {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    if (result.kind === "auth") {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json(
      { ok: false, error: result.error, errors: result.errors, warnings: result.warnings },
      { status: 502 },
    );
  }
  return NextResponse.json(result);
}
