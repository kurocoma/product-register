"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProductInput } from "@/lib/product/schema";
import { productToTemplateData } from "@/lib/template/template-data";
import { Button } from "@/components/ui/button";

/** 現在の編集内容を product_templates へテンプレートとして保存するボタン。
 * NEコード・JAN・商品名・価格などの商品固有項目は保存しない（productToTemplateData が除外）。
 * 保存したテンプレートは新規商品作成画面の「テンプレートから始める」で流し込める。 */
export function TemplateSaveButton({ data }: { data: ProductInput }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    const name = window.prompt(
      "テンプレート名を入力してください（例: お酒 単品 / お菓子 セット）",
      data.store_category || "",
    );
    if (!name || !name.trim()) return; // 空・キャンセルは何もしない
    setSaving(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("ログインが必要です");
      const { error } = await supabase.from("product_templates").insert({
        user_id: user.id,
        name: name.trim(),
        category: data.store_category || data.mall_category_id || "",
        template_data: productToTemplateData(data),
      });
      if (error) throw error;
      setMessage(`✓ 「${name.trim()}」を保存しました`);
    } catch (e) {
      setMessage("⚠ 保存に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={save} disabled={saving}>
        {saving ? "保存中…" : "📋 テンプレートとして保存"}
      </Button>
      {message && (
        <span className="max-w-52 truncate text-xs text-blue-700" title={message}>
          {message}
        </span>
      )}
    </div>
  );
}
