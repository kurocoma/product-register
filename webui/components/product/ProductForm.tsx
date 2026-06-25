"use client";

import * as React from "react";
import {
  useForm,
  FormProvider,
  useFormContext,
  useFieldArray,
  type FieldPath,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ProductInputBaseSchema,
  ProductInputSchema,
  type ProductInput,
} from "@/lib/product/schema";
import { createClient } from "@/lib/supabase/client";
import {
  fetchGenreAttributes,
  genreAttributesToInputs,
  isRequiredAttribute,
} from "@/lib/product/genre-attributes";
import { fetchYahooCategoryMapping } from "@/lib/product/category-mapping";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FormValues = z.input<typeof ProductInputBaseSchema>;

export function ProductForm({
  defaultValues,
  onChange,
}: {
  defaultValues: ProductInput;
  onChange?: (data: ProductInput) => void;
}) {
  // ProductInput には is_single/is_set 派生プロパティが含まれるので除く
  const { is_single, is_set, ...rest } = defaultValues;
  void is_single;
  void is_set;
  const initialForm = rest as FormValues;

  const methods = useForm<FormValues>({
    resolver: zodResolver(ProductInputBaseSchema) as never,
    defaultValues: initialForm,
    mode: "onChange",
  });

  React.useEffect(() => {
    const sub = methods.watch((value) => {
      try {
        const parsed = ProductInputSchema.parse(value);
        onChange?.(parsed);
      } catch {
        // バリデーションエラー時はスキップ
      }
    });
    return () => sub.unsubscribe();
  }, [methods, onChange]);

  return (
    <FormProvider {...methods}>
      <Accordion defaultOpen={["basic"]}>
        <AccordionItem value="basic" title="基本情報">
          <BasicInfoSection />
        </AccordionItem>
        <AccordionItem value="variants" title="SKU一覧 (多SKU価格・配送)">
          <VariantsSection />
        </AccordionItem>
        <AccordionItem value="shipping" title="配送・カテゴリ">
          <ShippingSection />
        </AccordionItem>
        <AccordionItem value="description" title="商品説明">
          <DescriptionSection />
        </AccordionItem>
        <AccordionItem value="yahoo" title="Yahoo grouping">
          <YahooGroupingSection />
        </AccordionItem>
        <AccordionItem value="variation" title="バリエーション">
          <VariationSection />
        </AccordionItem>
        <AccordionItem value="image" title="画像 URL (20)">
          <ImageUrlSection />
        </AccordionItem>
        <AccordionItem value="attribute" title="商品属性 (5)">
          <AttributeSection />
        </AccordionItem>
      </Accordion>
    </FormProvider>
  );
}

function TextField({
  name,
  label,
  type = "text",
}: {
  name: FieldPath<FormValues>;
  label: string;
  type?: string;
}) {
  const { register } = useFormContext<FormValues>();
  return (
    <div className="mb-3">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type={type}
        {...register(name, type === "number" ? { valueAsNumber: true } : undefined)}
      />
    </div>
  );
}

function BasicInfoSection() {
  const { register } = useFormContext<FormValues>();
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField name="ne_code" label="NEコード" />
      <TextField name="jan_code" label="JAN コード" />
      <TextField name="maker_code" label="メーカーコード" />
      <div className="mb-3">
        <Label htmlFor="product_type">商品種別</Label>
        <select
          id="product_type"
          {...register("product_type")}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="単品">単品</option>
          <option value="セット商品">セット商品</option>
        </select>
      </div>
      <TextField name="quantity" label="数量" type="number" />
      <TextField name="product_name" label="商品名 (NE用)" />
      <div className="col-span-2">
        <TextField name="display_name" label="掲載商品名 (モール用)" />
      </div>
      <div className="mb-3">
        <Label htmlFor="tax_rate">消費税率</Label>
        <select
          id="tax_rate"
          {...register("tax_rate", { valueAsNumber: true })}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value={8}>8%</option>
          <option value={10}>10%</option>
        </select>
      </div>
      <TextField name="cost_price" label="原価" type="number" />
      <TextField name="selling_price" label="販売価格" type="number" />
    </div>
  );
}

/** SKU一覧: 1商品ページ(楽天 商品管理番号)配下の複数SKUを、価格・配送ごとに編集する表。
 * variants[] を react-hook-form の field array で編集。空のときは単品(上の販売価格/送料)扱い。
 * 配送詳細(送料区分/配送方法セット/個別送料/置き配)はSKUごとに楽天 variant.shipping へ反映する(#3)。 */
function VariantsSection() {
  const { control, register } = useFormContext<FormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "variants" });
  const reg = (idx: number, field: string, opts?: Parameters<typeof register>[1]) =>
    register(`variants.${idx}.${field}` as FieldPath<FormValues>, opts);
  const cell = "rounded border border-slate-300 px-1 py-1";
  const headers = [
    "ラベル", "SKU管理番号", "NEコード", "JAN", "販売価格", "税率", "数量",
    "送料", "送料区分1", "送料区分2", "配送方法セット", "個別送料", "置き配", "",
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        1商品ページ(楽天 商品管理番号)配下の複数SKUを、SKUごとに価格・配送設定します（単品・セット・本数違い等）。
        空のときは上の「販売価格」「送料区分」を使う単品扱いです。楽天から多SKU商品を取込むと自動で入ります。
      </p>
      {fields.length === 0 ? (
        <p className="text-sm text-slate-400">SKUなし（単品）。「+ SKU追加」または楽天取込で追加できます。</p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="text-xs whitespace-nowrap">
            <thead className="bg-slate-100 text-left">
              <tr>{headers.map((h, i) => <th key={i} className="px-1.5 py-1.5 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {fields.map((f, idx) => (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="px-1"><input {...reg(idx, "variation_value")} className={`${cell} w-20`} /></td>
                  <td className="px-1"><input {...reg(idx, "sku_manage_number")} className={`${cell} w-28 font-mono`} /></td>
                  <td className="px-1"><input {...reg(idx, "ne_code")} className={`${cell} w-28 font-mono`} /></td>
                  <td className="px-1"><input {...reg(idx, "jan_code")} className={`${cell} w-32 font-mono`} /></td>
                  <td className="px-1"><input type="number" {...reg(idx, "selling_price", { valueAsNumber: true })} className={`${cell} w-20 text-right`} /></td>
                  <td className="px-1">
                    <select {...reg(idx, "tax_rate", { valueAsNumber: true })} className={`${cell} bg-white`}>
                      <option value={8}>8%</option><option value={10}>10%</option>
                    </select>
                  </td>
                  <td className="px-1"><input type="number" {...reg(idx, "quantity", { valueAsNumber: true })} className={`${cell} w-14 text-right`} /></td>
                  <td className="px-1">
                    <select {...reg(idx, "shipping_type")} className={`${cell} bg-white`}>
                      <option value="送料別">送料別</option><option value="送料無料">送料無料</option>
                    </select>
                  </td>
                  <td className="px-1"><input {...reg(idx, "postage_segment_1")} className={`${cell} w-14`} /></td>
                  <td className="px-1"><input {...reg(idx, "postage_segment_2")} className={`${cell} w-14`} /></td>
                  <td className="px-1"><input {...reg(idx, "shipping_method_group")} className={`${cell} w-24`} /></td>
                  <td className="px-1"><input {...reg(idx, "individual_shipping_fee")} className={`${cell} w-16`} /></td>
                  <td className="px-1 text-center"><input type="checkbox" {...reg(idx, "okihai")} /></td>
                  <td className="px-1"><button type="button" onClick={() => remove(idx)} className="text-red-600 hover:underline">削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          append({
            sku_manage_number: "", ne_code: "", jan_code: "", selling_price: 0, tax_rate: 10, quantity: 1,
            variation_value: "", shipping_type: "送料別", postage_segment_1: "", postage_segment_2: "",
            shipping_method_group: "", individual_shipping_fee: "", okihai: true, attributes: [],
          })
        }
      >
        + SKU追加
      </Button>
    </div>
  );
}

function ShippingSection() {
  const { register } = useFormContext<FormValues>();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="mb-3">
        <Label htmlFor="shipping_type">送料区分</Label>
        <select
          id="shipping_type"
          {...register("shipping_type")}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="送料無料">送料無料</option>
          <option value="送料別">送料別</option>
        </select>
      </div>
      <TextField name="image_count" label="画像枚数" type="number" />
      <TextField name="delivery_method" label="配送方法セット" type="number" />
      <TextField name="lead_time" label="納期管理番号" type="number" />
      <MallCategoryField />
      <TextField name="store_category" label="店舗内カテゴリ" />
    </div>
  );
}

/** モール基本カテゴリID(=楽天ジャンルID)。入力（フォーカス離脱）時に、
 * 紐付くYahooカテゴリ(yahoo_category_id / yahoo_path)を自動入力する。 */
function MallCategoryField() {
  const { register, setValue, watch } = useFormContext<FormValues>();
  const [message, setMessage] = React.useState<string | null>(null);
  const lastMappedId = React.useRef<string | null>(null);
  const reg = register("mall_category_id");
  const yahooCategoryId = watch("yahoo_category_id");

  const autofillYahoo = async (e: React.FocusEvent<HTMLInputElement>) => {
    const id = (e.target.value || "").trim();
    if (!id || id === lastMappedId.current) return; // 空 or 同一IDの再blurはスキップ
    lastMappedId.current = id;
    try {
      const supabase = createClient();
      const mapping = await fetchYahooCategoryMapping(supabase, id);
      if (!mapping) {
        setMessage(`カテゴリID ${id} に対応するYahooカテゴリが見つかりませんでした`);
        return;
      }
      const opts = { shouldDirty: true, shouldValidate: true } as const;
      setValue("yahoo_category_id", mapping.yahoo_category_id, opts);
      setValue("yahoo_path", mapping.yahoo_path, opts);
      setMessage(`Yahooカテゴリを自動入力: ${mapping.yahoo_path || mapping.yahoo_category_id}`);
    } catch (err) {
      lastMappedId.current = null; // 失敗時は再試行できるようにする
      setMessage("Yahooカテゴリの取得に失敗しました: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="mb-3">
      <Label htmlFor="mall_category_id">モール基本カテゴリID</Label>
      <Input
        id="mall_category_id"
        {...reg}
        onBlur={(e) => {
          reg.onBlur(e);
          void autofillYahoo(e);
        }}
      />
      {message && <p className="mt-1 text-xs text-blue-700">{message}</p>}
      <p className="mt-0.5 text-[11px] text-slate-400">
        現在の Yahoo カテゴリID: {yahooCategoryId || "(未入力)"}
      </p>
    </div>
  );
}

function DescriptionSection() {
  const { register } = useFormContext<FormValues>();
  return (
    <div className="space-y-3">
      <TextField name="catch_copy_pc" label="キャッチコピー (PC)" />
      <TextField name="catch_copy_yahoo" label="キャッチコピー (Yahoo)" />
      <div>
        <Label htmlFor="sale_description_pc">PC用販売説明文 (楽天 / 任意HTML)</Label>
        <textarea
          id="sale_description_pc"
          {...register("sale_description_pc")}
          rows={6}
          placeholder="例: <img src='...' width='100%'> … 空欄なら画像枚数から自動生成"
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-mono"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          空欄時は商品画像から imgList を自動生成。入力すると PC用販売説明文・スマホ用商品説明文の先頭に使われます。
        </p>
      </div>
      <div>
        <Label htmlFor="description_pc">商品説明 PC (HTML)</Label>
        <textarea
          id="description_pc"
          {...register("description_pc")}
          rows={8}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-mono"
        />
      </div>
      <div>
        <Label htmlFor="description_sp">商品説明 スマホ (HTML)</Label>
        <textarea
          id="description_sp"
          {...register("description_sp")}
          rows={6}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-mono"
        />
      </div>
      <TextField name="keyword" label="検索キーワード" />
      <TextField name="maker_name" label="メーカー名" />
      <TextField name="brand_name" label="ブランド名" />
    </div>
  );
}

function YahooGroupingSection() {
  const { register } = useFormContext<FormValues>();
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField name="yahoo_category_id" label="Yahoo カテゴリID" />
      <TextField name="yahoo_path" label="Yahoo ストアカテゴリパス" />
      <TextField name="unit" label="単位 (本/袋/個/枚 等)" />
      <div className="mb-3">
        <Label htmlFor="yahoo_grouping_enabled">grouping 有効化</Label>
        <select
          id="yahoo_grouping_enabled"
          {...register("yahoo_grouping_enabled", {
            setValueAs: (v) => v === "true" || v === true,
          })}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="false">FALSE</option>
          <option value="true">TRUE</option>
        </select>
      </div>
      <div className="col-span-2">
        <TextField name="yahoo_variation_title" label="バリエーション見出し (例: 数量)" />
      </div>
    </div>
  );
}

function VariationSection() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TextField name="option_item_name" label="項目選択肢項目名" />
      <TextField name="variation_key" label="バリエーション項目キー" />
      <TextField name="variation_name" label="バリエーション項目名" />
      <TextField name="variation_choices" label="選択肢定義 (パイプ区切り)" />
    </div>
  );
}

function ImageUrlSection() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: 20 }, (_, i) => i + 1).map((i) => (
        <TextField
          key={i}
          name={`image_url_${i}` as FieldPath<FormValues>}
          label={`画像 URL ${i}`}
        />
      ))}
    </div>
  );
}

function AttributeSection() {
  const { control, register, watch } = useFormContext<FormValues>();
  const { fields, append, remove, replace } = useFieldArray({ control, name: "attributes" });
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const categoryId = watch("mall_category_id");

  const loadFromCategory = async () => {
    const id = (categoryId || "").trim();
    if (!id) {
      setMessage("先に「配送・カテゴリ」のモール基本カテゴリIDを入力してください");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const attrs = await fetchGenreAttributes(supabase, id);
      if (attrs.length === 0) {
        setMessage(`カテゴリID ${id} に対応する推奨属性が見つかりませんでした`);
        return;
      }
      // 既存の入力値（item→value/unit）を保持しつつ、推奨項目で置き換える
      const current = watch("attributes") || [];
      const byItem = new Map(current.map((a) => [a.item, a]));
      const next = genreAttributesToInputs(attrs).map((a) => {
        const prev = byItem.get(a.item);
        return prev
          ? { item: a.item, value: prev.value, unit: prev.unit || a.unit, requirement: a.requirement }
          : a;
      });
      replace(next);
      setMessage(`カテゴリID ${id} の推奨属性 ${next.length} 件を読み込みました`);
    } catch (e) {
      setMessage("属性の読み込みに失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button type="button" onClick={loadFromCategory} disabled={loading} variant="outline">
          {loading ? "読み込み中…" : "📥 カテゴリIDから属性を読み込む"}
        </Button>
        <span className="text-xs text-slate-500">
          現在のカテゴリID: {categoryId || "(未入力)"}
        </span>
      </div>
      {message && <p className="text-xs text-blue-700">{message}</p>}

      {fields.length === 0 && (
        <p className="text-sm text-slate-400">
          属性がありません。上のボタンでカテゴリIDから読み込むか、「+ 項目を追加」で手動入力できます。
        </p>
      )}

      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-rose-100 border border-rose-300" />
          必須項目
        </span>
      </div>

      <div className="space-y-2">
        {fields.map((field, idx) => {
          const requirement = watch(`attributes.${idx}.requirement`) as string | undefined;
          const required = isRequiredAttribute(requirement || "");
          return (
            <div
              key={field.id}
              className={cn(
                "grid grid-cols-[1fr_1fr_80px_auto] gap-2 items-end border-t pt-2 first:border-t-0 first:pt-0 rounded-sm",
                required && "bg-rose-50 border-rose-200 px-2 py-1",
              )}
            >
              <div>
                {idx === 0 && <Label>項目</Label>}
                <div className="flex items-center gap-1">
                  <Input {...register(`attributes.${idx}.item` as FieldPath<FormValues>)} />
                  {required && (
                    <span className="shrink-0 text-[10px] font-bold text-rose-700 bg-rose-200 rounded px-1 py-0.5">
                      必須
                    </span>
                  )}
                </div>
              </div>
              <div>
                {idx === 0 && <Label>値</Label>}
                <Input {...register(`attributes.${idx}.value` as FieldPath<FormValues>)} />
              </div>
              <div>
                {idx === 0 && <Label>単位</Label>}
                <Input {...register(`attributes.${idx}.unit` as FieldPath<FormValues>)} />
              </div>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-xs text-red-600 hover:underline pb-2"
              >
                削除
              </button>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={() => append({ item: "", value: "", unit: "", requirement: "" })}
      >
        + 項目を追加
      </Button>
    </div>
  );
}
