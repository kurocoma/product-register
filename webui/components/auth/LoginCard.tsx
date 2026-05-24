"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export function LoginCard() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
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
        {sent ? (
          <p className="text-center text-sm text-green-700">
            ログインリンクをメールに送信しました
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button onClick={sendMagicLink} className="w-full" disabled={loading || !email}>
              {loading ? "送信中..." : "Magic Link を送信"}
            </Button>
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
