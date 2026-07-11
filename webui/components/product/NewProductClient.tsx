"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { ProductInputSchema, type ProductInput } from "@/lib/product/schema";
import { applyTemplateToProduct } from "@/lib/template/template-data";
import { ProductEditView } from "./ProductEditView";
import { Button } from "@/components/ui/button";

type TemplateRow = {
  id: string;
  name: string;
  category: string | null;
  template_data: Record<string, unknown> | null;
};

/** 新規作成時の空デフォルト（テンプレート流し込みの base にも使う）。 */
function emptyProduct(): ProductInput {
  return ProductInputSchema.parse({
    ne_code: "",
    jan_code: "0000000000000",
    maker_code: "",
    product_type: "単品",
    quantity: 1,
    product_name: "",
    display_name: "",
    tax_rate: 10,
    selling_price: 0,
    shipping_type: "送料別",
    image_count: 1,
    delivery_method: 4,
    lead_time: 1,
    mall_category_id: "",
  });
}

/** 新規商品作成画面（クライアント側）。
 * 上部の「テンプレートから始める」バーでテンプレートを選んで流し込める。
 * 適用時は key を替えて ProductEditView を再マウントする（ProductForm の defaultValues は初回のみ有効なため）。 */
export function NewProductClient({ initialTemplateId }: { initialTemplateId?: string }) {
  const [templates, setTemplates] = React.useState<TemplateRow[]>([]);
  const [selectedId, setSelectedId] = React.useState(initialTemplateId ?? "");
  const [initial, setInitial] = React.useState<ProductInput>(() => emptyProduct());
  const [formKey, setFormKey] = React.useState("blank-0");
  const [message, setMessage] = React.useState<string | null>(null);
  const applyCount = React.useRef(0);
  const autoApplied = React.useRef(false);

  const applyTemplate = React.useCallback(
    (t: TemplateRow | null, opts?: { skipConfirm?: boolean }) => {
      if (
        !opts?.skipConfirm &&
        !window.confirm("テンプレートを適用すると現在の入力内容が置き換わります。よろしいですか？")
      ) {
        return;
      }
      applyCount.current += 1;
      try {
        if (!t) {
          // 「テンプレートなし」= 白紙に戻す
          setInitial(emptyProduct());
          setFormKey(`blank-${applyCount.current}`);
          setMessage("白紙の新規商品に戻しました");
          return;
        }
        setInitial(applyTemplateToProduct(t.template_data ?? {}, emptyProduct()));
        setSelectedId(t.id);
        setFormKey(`${t.id}-${applyCount.current}`);
        setMessage(`✓ テンプレート「${t.name}」を適用しました`);
      } catch (e) {
        setMessage(
          "⚠ テンプレートの適用に失敗しました: " + (e instanceof Error ? e.message : String(e)),
        );
      }
    },
    [],
  );

  // テンプレート一覧の取得 + URL(?template=)指定の初期適用
  React.useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("product_templates")
          .select("id, name, category, template_data")
          .order("updated_at", { ascending: false });
        if (error) throw error;
        const rows = (data ?? []) as TemplateRow[];
        setTemplates(rows);
        if (initialTemplateId && !autoApplied.current) {
          autoApplied.current = true;
          const t = rows.find((r) => r.id === initialTemplateId);
          // URL指定の初期適用はまだ何も入力していないので confirm 不要
          if (t) applyTemplate(t, { skipConfirm: true });
          else setMessage("⚠ 指定されたテンプレートが見つかりませんでした");
        }
      } catch (e) {
        setMessage(
          "⚠ テンプレート一覧の取得に失敗しました: " + (e instanceof Error ? e.message : String(e)),
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* テンプレートから始めるバー */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-blue-50/60 px-6 py-2 text-sm">
        <span className="font-medium text-slate-700">📋 テンプレートから始める</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          <option value="">テンプレートなし（白紙）</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.category ? `（${t.category}）` : ""}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          className="px-3 py-1"
          onClick={() => applyTemplate(templates.find((t) => t.id === selectedId) ?? null)}
        >
          適用
        </Button>
        <span className="text-xs text-slate-500">
          💡 NEコード・JAN・商品名・価格は流し込まれません（商品ごとに入力）
        </span>
        {message && <span className="text-xs text-blue-700">{message}</span>}
      </div>
      <div className="min-h-0 flex-1">
        <ProductEditView key={formKey} initial={initial} />
      </div>
    </div>
  );
}
