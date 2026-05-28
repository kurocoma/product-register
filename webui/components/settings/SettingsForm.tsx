"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

type StoreSettings = {
  rakuten_store_id: string;
  rakuten_cabinet_url_base: string;
  yahoo_store_id: string;
  shopify_store_id: string;
};

export function SettingsForm({ initial }: { initial: StoreSettings }) {
  const [data, setData] = useState<StoreSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    await supabase.from("settings").upsert({
      user_id: user.id,
      ...data,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    setSavedAt(new Date());
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">設定</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">店舗情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="rakuten">楽天店舗 ID</Label>
            <Input
              id="rakuten"
              value={data.rakuten_store_id}
              onChange={(e) => setData({ ...data, rakuten_store_id: e.target.value })}
              placeholder="例: ichiban-okinawa"
            />
          </div>
          <div>
            <Label htmlFor="rcabinet">R-Cabinet URL ベース</Label>
            <Input
              id="rcabinet"
              value={data.rakuten_cabinet_url_base}
              onChange={(e) => setData({ ...data, rakuten_cabinet_url_base: e.target.value })}
              placeholder="例: https://image.rakuten.co.jp/ichiban-okinawa/cabinet/"
            />
          </div>
          <div>
            <Label htmlFor="yahoo">Yahoo ストア ID</Label>
            <Input
              id="yahoo"
              value={data.yahoo_store_id}
              onChange={(e) => setData({ ...data, yahoo_store_id: e.target.value })}
              placeholder="例: okimarumarket"
            />
          </div>
          <div>
            <Label htmlFor="shopify">Shopify ストア</Label>
            <Input
              id="shopify"
              value={data.shopify_store_id}
              onChange={(e) => setData({ ...data, shopify_store_id: e.target.value })}
              placeholder="例: kurima-okinawa"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
        {savedAt && (
          <span className="text-sm text-green-700">
            ✓ 保存しました ({savedAt.toLocaleTimeString("ja-JP")})
          </span>
        )}
      </div>
    </div>
  );
}
