import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // 未ログインで保護領域にアクセスしたら /login へ
  if (!user && !pathname.startsWith("/login") && !pathname.startsWith("/auth")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // ログイン済みで /login にアクセスしたら / へ
  // ただし /auth/reset-password はリセットリンク経由で一時的にログイン状態になるので除外
  if (user && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)"],
};
