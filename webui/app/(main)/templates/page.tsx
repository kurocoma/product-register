import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HelpLink } from "@/components/help/HelpLink";
import { TemplateList, type TemplateListItem } from "@/components/templates/TemplateList";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_templates")
    .select("id, name, category, updated_at")
    .order("updated_at", { ascending: false });
  const templates = (data ?? []) as TemplateListItem[];

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">テンプレート管理</h1>
        <HelpLink anchor="screen-templates" />
      </div>

      <p className="text-sm text-slate-600">
        💡 新しいテンプレートは、
        <Link href="/products" className="text-blue-600 hover:underline">
          商品一覧
        </Link>
        から商品を開き、商品編集画面ヘッダの「📋 テンプレートとして保存」ボタンで作成します。
      </p>

      <TemplateList initialTemplates={templates} />

      <p className="text-xs text-slate-500">
        💡 使い方: 商品編集画面で「📋 テンプレートとして保存」→ 新規商品作成画面の
        「テンプレートから始める」で選んで適用すると、税率・配送・カテゴリ・説明文などが流し込まれます。
        NEコード・JAN・商品名・価格はテンプレートに含まれません（商品ごとに入力します）。
      </p>
    </div>
  );
}
