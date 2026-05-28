import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("product_templates")
    .select("*")
    .order("updated_at", { ascending: false });

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">テンプレート管理</h1>
        <Button variant="outline">+ 新規テンプレート (未実装)</Button>
      </div>

      <Card>
        <CardContent>
          {!templates || templates.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              テンプレートがありません。商品の典型パターン (お酒 単品 / お菓子 セット 等) を
              登録すると、新規商品作成時に流し込めます。
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {templates.map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-slate-500">
                      {t.category || "(カテゴリ未設定)"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        💡 現在は雛形テーブルのみ。 新規商品作成時の流し込み UI は将来拡張で対応予定。
      </p>
    </div>
  );
}
