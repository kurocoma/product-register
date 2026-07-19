import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten";
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
  const publish: boolean = reqBody?.publish === true;
  // warehouse === false のときだけ現状維持（未指定の旧クライアント・一括経路は従来どおり倉庫）
  const keepExistingState: boolean = reqBody?.warehouse === false;

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const result = await commitRakutenRegister(supabase, cred, product, id, { publish, keepExistingState });
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
