"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Mode = "password" | "magic-link";

export function LoginCard() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithPassword = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  const signUp = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Email 確認設定が ON の場合、 session が空でメール確認待ち
    if (data.user && !data.session) {
      setSignedUp(true);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  const sendMagicLink = async () => {
    if (!email) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setMagicSent(true);
  };

  const signInWithGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-center text-2xl">商品登録アプリ</CardTitle>
        <p className="text-center text-sm text-slate-500 mt-1">EC 商品データをまとめて登録</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* タブ切替 */}
        <div className="flex border-b border-slate-200">
          <TabButton active={mode === "password"} onClick={() => { setMode("password"); setError(null); setMagicSent(false); setSignedUp(false); }}>
            パスワード
          </TabButton>
          <TabButton active={mode === "magic-link"} onClick={() => { setMode("magic-link"); setError(null); setMagicSent(false); setSignedUp(false); }}>
            Magic Link
          </TabButton>
        </div>

        {magicSent ? (
          <p className="text-center text-sm text-green-700">
            ログインリンクをメールに送信しました
          </p>
        ) : signedUp ? (
          <p className="text-center text-sm text-green-700">
            登録確認メールを送信しました。メールのリンクをクリックしてください。
          </p>
        ) : (
          <>
            <div>
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>

            {mode === "password" && (
              <div>
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {mode === "password" ? (
              <div className="space-y-2">
                <Button
                  onClick={signInWithPassword}
                  className="w-full"
                  disabled={loading || !email || !password}
                >
                  {loading ? "..." : "ログイン"}
                </Button>
                <Button
                  onClick={signUp}
                  variant="outline"
                  className="w-full"
                  disabled={loading || !email || !password}
                >
                  新規登録
                </Button>
              </div>
            ) : (
              <Button
                onClick={sendMagicLink}
                className="w-full"
                disabled={loading || !email}
              >
                {loading ? "送信中..." : "Magic Link を送信"}
              </Button>
            )}

            <div className="text-center text-xs text-slate-400">または</div>
            <Button onClick={signInWithGoogle} variant="outline" className="w-full">
              Google でログイン
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 py-2 text-sm font-medium border-b-2 transition-colors",
        active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700",
      )}
    >
      {children}
    </button>
  );
}
