import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import {
  dryRunRakutenRegister,
  commitRakutenRegister,
} from "@/lib/register/rakuten-register-service";

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

/** POST = commit（items.upsert 実行）。body: { publish?: boolean }
 * 安全登録が既定: 倉庫(hideItem)・サーチ在庫非表示(hideStock)・在庫0。publish=true で公開。
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

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  const result = await commitRakutenRegister(supabase, cred, product, id, { publish });
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
