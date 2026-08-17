import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service Role クライアント（RLS を通らない・サーバ専用）。
 * 公開リンク一覧（/links/*）のような「未ログインでも読ませたい読取専用ページ」の
 * SSR だけで使う。鍵・クライアントをブラウザへ渡さないこと（AGENTS.md データアクセス）。
 * SUPABASE_SERVICE_ROLE_KEY 未設定なら null（ページ側でエラー表示にフォールバック）。 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createSupabaseClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
