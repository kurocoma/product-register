import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** 開発環境専用の自動ログイン（open-local.bat 用）。
 * 既存 e2e と同じ magiclink 方式: service role で generateLink → verifyOtp で
 * セッション cookie を発行し、トップへリダイレクトする。
 * - 本番ビルド（NODE_ENV!==development）では 404 を返し存在しない扱い。
 * - 対象メールは ?email= > 環境変数 DEV_AUTOLOGIN_EMAIL > 既定 の順で解決。
 * - middleware は /auth 配下を素通しするため未ログインでも到達できる。 */
const DEFAULT_EMAIL = "kurocommerce@gmail.com";

export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return new NextResponse("Supabase の環境変数が未設定です (.env.local)", { status: 500 });
  }
  const email =
    new URL(req.url).searchParams.get("email") ||
    process.env.DEV_AUTOLOGIN_EMAIL ||
    DEFAULT_EMAIL;

  // すでにログイン済みならそのままトップへ
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return NextResponse.redirect(new URL("/", req.url));

  const admin = createAdminClient(url, serviceKey);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) {
    return new NextResponse(
      `自動ログイン失敗（${email}）: ${error?.message ?? "リンク生成に失敗"}`,
      { status: 500 },
    );
  }
  const { error: otpErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (otpErr) {
    return new NextResponse(`自動ログイン失敗（${email}）: ${otpErr.message}`, { status: 500 });
  }
  return NextResponse.redirect(new URL("/", req.url));
}
