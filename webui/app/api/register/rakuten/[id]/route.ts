import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten";
import { registerStateToOpts } from "@/lib/register";
import {
  dryRunRakutenRegister,
  commitRakutenRegister,
} from "@/lib/register";

export const runtime = "nodejs";

/** GET = dry-run プレビュー（書き込みなし）。送信予定の upsert body と既存有無を返す。
 * ロジックは lib/register/rakuten-register-service.ts に集約（一括登録と共用）。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  return NextResponse.json(await dryRunRakutenRegister(cred, product));
}

/** POST = commit（items.upsert 実行）。body: { publish?: boolean, warehouse?: boolean }
 * 安全登録が既定: 倉庫(hideItem)・サーチ在庫非表示(hideStock)。publish=true で公開。
 * warehouse=false で既存商品の倉庫/公開状態を現状維持（260720仕様変更。新規は倉庫のまま）。
 * 在庫: SKU の stock_quantity 入力済み→その値／未入力: 既存=変更しない・新規=0。
 * ⚠ upsert は全置換。多SKU商品は variants[] 全件を展開して送る。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });

  const reqBody = await req.json().catch(() => ({}));
  // 登録後の状態（260720）: state = "publish"（公開/倉庫解除） | "keep"（現状維持） | "warehouse"（倉庫）。
  // 旧クライアント互換: state 未指定時は publish / warehouse===false（現状維持）を従来どおり解釈。
  const state = reqBody?.state;
  const opts =
    state === "publish" || state === "keep" || state === "warehouse"
      ? registerStateToOpts(state)
      : { publish: reqBody?.publish === true, keepExistingState: reqBody?.warehouse === false };

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const result = await commitRakutenRegister(supabase, cred, product, id, opts);
  if (!result.ok) {
    if (result.kind === "api") {
      return NextResponse.json(
        { ok: false, error: result.error, status: result.apiStatus, detail: result.detail },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
