"use client";

import * as React from "react";
import { useForm, FormProvider, useFormContext, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ProductInputBaseSchema,
  ProductInputSchema,
  type ProductInput,
} from "@/lib/product/schema";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Input, Label } from "@/components/ui/input";

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
      <TextField name="mall_category_id" label="モール基本カテゴリID" />
      <TextField name="store_category" label="店舗内カテゴリ" />
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
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }, (_, i) => i + 1).map((i) => (
        <div key={i} className="grid grid-cols-3 gap-2 border-t pt-2 first:border-t-0 first:pt-0">
          <TextField
            name={`attribute_item_${i}` as FieldPath<FormValues>}
            label={`項目 ${i}`}
          />
          <TextField
            name={`attribute_value_${i}` as FieldPath<FormValues>}
            label={`値 ${i}`}
          />
          <TextField
            name={`attribute_unit_${i}` as FieldPath<FormValues>}
            label={`単位 ${i}`}
          />
        </div>
      ))}
    </div>
  );
}
