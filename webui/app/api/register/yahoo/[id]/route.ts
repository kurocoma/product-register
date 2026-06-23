import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput } from "@/lib/product/repository";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo/auth";
import { buildYahooEditItemParams, validateEditItemParams } from "@/lib/yahoo/item-mapper";
import { editItem, submitItem, getItem } from "@/lib/yahoo/item-client";

export const runtime = "nodejs";

/** GET = dry-run プレビュー（書き込みなし）。送信予定の editItem パラメータと、
 * 既存商品の有無（更新になるか新規になるか）を返す。 */
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

  // 既存商品の有無を確認（更新か新規かでマージ方針が変わる）
  let exists = false;
  try {
    const token = await getYahooAccessToken(cfg);
    exists = (await getItem(token, cfg.sellerId, product.ne_code)).exists;
  } catch {
    // 認証失敗時もプレビュー自体は返す（送信予定値の確認が目的）
  }

  const editParams = buildYahooEditItemParams(product, { sellerId: cfg.sellerId, forUpdate: exists });
  const valid = validateEditItemParams(editParams);
  return NextResponse.json({
    ok: true,
    dryRun: true,
    mall: "yahoo",
    itemCode: product.ne_code,
    exists,
    willOverwrite: exists,
    valid: valid.ok,
    missing: valid.ok ? [] : valid.missing,
    params: editParams,
  });
}

/** POST = commit（editItem 実行）。body: { submit?: boolean, forceDisplay?: string }
 * - 既存商品があれば forUpdate（display を送らず公開状態維持）。
 * - submit=true なら submitItem で個別反映まで行う。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cfg = getYahooConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const doSubmit = body?.submit === true;
  // 安全登録が既定: display=0(非表示)。body.publish=true で公開(display=1)。
  // forceDisplay 明示指定があれば最優先（テスト用）。
  const publish: boolean = body?.publish === true;
  const forceDisplay: string | undefined =
    typeof body?.forceDisplay === "string" ? body.forceDisplay : publish ? undefined : "0";

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  let token: string;
  try {
    token = await getYahooAccessToken(cfg);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証）" }, { status: 502 });
  }

  const exists = (await getItem(token, cfg.sellerId, product.ne_code)).exists;
  const editParams = buildYahooEditItemParams(product, { sellerId: cfg.sellerId, forUpdate: exists, forceDisplay });
  const valid = validateEditItemParams(editParams);
  if (!valid.ok) return NextResponse.json({ ok: false, error: "必須項目が不足: " + valid.missing.join(", ") }, { status: 400 });

  const result = await editItem(token, editParams);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "editItem 失敗: " + result.message, errors: result.errors, warnings: result.warnings }, { status: 502 });
  }

  let submitted = false;
  let submitMessage = "";
  if (doSubmit) {
    const s = await submitItem(token, cfg.sellerId, product.ne_code);
    submitted = s.ok;
    submitMessage = s.message;
  }

  return NextResponse.json({
    ok: true,
    mall: "yahoo",
    itemCode: product.ne_code,
    wasUpdate: exists,
    warnings: result.warnings,
    submitted,
    submitMessage,
  });
}
