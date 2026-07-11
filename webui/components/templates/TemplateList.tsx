"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

export type TemplateListItem = {
  id: string;
  name: string;
  category: string | null;
  updated_at: string;
};

/** テンプレート一覧（クライアント側）。
 * 各行から「このテンプレートで新規作成」(/products/new?template=<id>) と削除ができる。 */
export function TemplateList({ initialTemplates }: { initialTemplates: TemplateListItem[] }) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [message, setMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const remove = async (t: TemplateListItem) => {
    if (!window.confirm(`テンプレート「${t.name}」を削除しますか？`)) return;
    setDeletingId(t.id);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("product_templates").delete().eq("id", t.id);
      if (error) throw error;
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      setMessage(`✓ テンプレート「${t.name}」を削除しました`);
    } catch (e) {
      setMessage("⚠ 削除に失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardContent>
        {message && <p className="pb-1 text-xs text-blue-700">{message}</p>}
        {templates.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">
            テンプレートがありません。商品の典型パターン (お酒 単品 / お菓子 セット 等) を
            商品編集画面の「📋 テンプレートとして保存」で登録すると、新規商品作成時に流し込めます。
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {templates.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-slate-500">
                    {t.category || "(カテゴリ未設定)"} ・ 更新:{" "}
                    <span suppressHydrationWarning>{formatDate(t.updated_at)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/products/new?template=${t.id}`}
                    className="rounded border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    このテンプレートで新規作成
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(t)}
                    disabled={deletingId === t.id}
                    className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingId === t.id ? "削除中…" : "削除"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
