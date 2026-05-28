"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (password.length < 6) {
      setError("パスワードは 6 文字以上で入力してください");
      return;
    }
    if (password !== confirm) {
      setError("パスワードと確認が一致しません");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1500);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-center text-2xl">新しいパスワードを設定</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {done ? (
          <p className="text-center text-sm text-green-700">
            ✓ パスワードを更新しました。 ダッシュボードへ移動します...
          </p>
        ) : (
          <>
            <div>
              <Label htmlFor="new-password">新しいパスワード (6文字以上)</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="confirm">パスワード確認</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              onClick={submit}
              className="w-full"
              disabled={loading || !password || !confirm}
            >
              {loading ? "更新中..." : "パスワードを更新"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
