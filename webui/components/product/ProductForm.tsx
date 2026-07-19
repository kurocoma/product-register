"use client";

import * as React from "react";
import {
  useForm,
  FormProvider,
  useFormContext,
  useFieldArray,
  type FieldPath,
  type FieldArrayPath,
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
  countEmptyRequiredAttributes,
  fetchGenreAttributes,
  genreAttributesToInputs,
  isRequiredAttribute,
} from "@/lib/product/genre-attributes";
import { fetchYahooCategoryMapping } from "@/lib/product/category-mapping";
import { mergeGenreAttributes } from "@/lib/product/category-autofill";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { emptySafeNumber } from "@/lib/product/form-number";

type FormValues = z.input<typeof ProductInputBaseSchema>;

export type CodexEditableProductField =
  | "sale_description_pc"
  | "description_pc"
  | "description_sp"
  | `image_url_${number}`;

/** フォーム外（MallEditPanel の formApi / 白背景アップロードのブリッジ）から
 * 読み書きできる項目。white_bg_image_url は白背景(wb01)アップロード結果の
 * 自動反映先（楽天 whiteBgImage）。 */
export type ProductFormEditableField = CodexEditableProductField | "white_bg_image_url";

export type ProductFormApi = {
  getValue: (name: ProductFormEditableField) => string;
  setValue: (name: ProductFormEditableField, value: string) => void;
};

/** 白背景(wb01)アップロード結果をフォームへ届けるモジュール内ブリッジ。
 * ImageUploadPanel は ProductForm と親(ProductEditView)を介さず横並びに置かれるため、
 * マウント中の ProductForm がここに listener を登録し、white_bg_image_url へ反映する。
 * （商品編集画面には ProductForm は同時に1つしか無い前提。） */
const whiteBgUploadListeners = new Set<(url: string) => void>();

/** 白背景(wb01)画像のアップロード成功を商品編集フォームへ通知する。
 * フォームが開いていれば「白背景画像」欄(white_bg_image_url)へ自動反映して true を返す。
 * 開いていなければ false（呼び出し側は手動貼り付けの案内を出す）。 */
export function notifyWhiteBgImageUploaded(url: string): boolean {
  if (whiteBgUploadListeners.size === 0) return false;
  whiteBgUploadListeners.forEach((listener) => listener(url));
  return true;
}

export function ProductForm({
  defaultValues,
  onChange,
  productId,
  onFormApiReady,
}: {
  defaultValues: ProductInput;
  onChange?: (data: ProductInput) => void;
  /** 保存済み商品のID。画像の再アップロード等、サーバー処理を伴う操作に使う（未保存時は無効化）。 */
  productId?: string;
  /** 兄弟コンポーネントからもRHFの登録値を安全に取得・更新するためのAPI。 */
  onFormApiReady?: (api: ProductFormApi | null) => void;
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

  const formApi = React.useMemo<ProductFormApi>(
    () => ({
      getValue: (name) =>
        String(methods.getValues(name as FieldPath<FormValues>) ?? ""),
      setValue: (name, value) =>
        methods.setValue(name as FieldPath<FormValues>, value as never, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        }),
    }),
    [methods],
  );

  React.useEffect(() => {
    onFormApiReady?.(formApi);
    return () => onFormApiReady?.(null);
  }, [formApi, onFormApiReady]);

  // 白背景(wb01)アップロード成功（ImageUploadPanel → notifyWhiteBgImageUploaded）を
  // 「白背景画像」欄へ自動反映する（楽天 whiteBgImage の反映元。白背景は商品につき1枚）。
  React.useEffect(() => {
    const listener = (url: string) => formApi.setValue("white_bg_image_url", url);
    whiteBgUploadListeners.add(listener);
    return () => {
      whiteBgUploadListeners.delete(listener);
    };
  }, [formApi]);

  React.useEffect(() => {
    return methods.subscribe({
      formState: { values: true },
      callback: ({ values }) => {
        try {
          const parsed = ProductInputSchema.parse(values);
          onChange?.(parsed);
        } catch {
          // バリデーションエラー時はスキップ
        }
      },
    });
  }, [methods, onChange]);

  return (
    <FormProvider {...methods}>
      {/* トグル(折りたたみ)は初期状態で全セクション展開（開閉自体は引き続き可能） */}
      <Accordion
        defaultOpen={[
          "basic",
          "variants",
          "shipping",
          "description",
          "yahoo",
          "variation",
          "subscription",
          "image",
          "white_bg",
          "attribute",
        ]}
      >
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
        <AccordionItem value="subscription" title="定期購入 (楽天 / Yahoo!ショッピング)">
          <SubscriptionSection />
        </AccordionItem>
        <AccordionItem value="image" title="画像 URL (20)">
          <ImageUrlSection productId={productId} />
        </AccordionItem>
        <AccordionItem value="white_bg" title="白背景画像 (楽天)">
          <WhiteBgImageSection />
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
        {...register(name, type === "number" ? { setValueAs: emptySafeNumber } : undefined)}
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
 * 配送詳細(送料区分/配送方法セット/個別送料/置き配)はSKUごとに楽天 variant.shipping へ反映する(#3)。
 * SKU画像URL列はSKU管理画像（楽天 variants.{}.images、各SKUに1枚）として反映される。 */
function VariantsSection() {
  const { control, register, watch } = useFormContext<FormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "variants" });
  const reg = (idx: number, field: string, opts?: Parameters<typeof register>[1]) =>
    register(`variants.${idx}.${field}` as FieldPath<FormValues>, opts);
  const cell = "rounded border border-slate-300 px-1 py-1";
  const headers = [
    "ラベル", "SKU管理番号", "NEコード", "JAN", "販売価格", "表示価格", "税率", "数量",
    "送料", "送料区分1", "送料区分2", "配送方法セット", "納期ID", "個別送料", "置き配", "SKU画像URL", "",
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        1商品ページ(楽天 商品管理番号)配下の複数SKUを、SKUごとに価格・配送設定します（単品・セット・本数違い等）。
        空のときは上の「販売価格」「送料区分」を使う単品扱いです。楽天から多SKU商品を取込むと自動で入ります。
        「SKU画像URL」はSKUごとの管理画像（各SKUに1枚・R-CabinetのURL）として楽天へ反映されます。
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
              {fields.map((f, idx) => {
                const skuImageUrl = String(
                  watch(`variants.${idx}.image_url` as FieldPath<FormValues>) ?? "",
                );
                return (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="px-1"><input {...reg(idx, "variation_value")} className={`${cell} w-20`} /></td>
                  <td className="px-1"><input {...reg(idx, "sku_manage_number")} className={`${cell} w-28 font-mono`} /></td>
                  <td className="px-1"><input {...reg(idx, "ne_code")} className={`${cell} w-28 font-mono`} /></td>
                  <td className="px-1"><input {...reg(idx, "jan_code")} className={`${cell} w-32 font-mono`} /></td>
                  <td className="px-1"><input type="number" {...reg(idx, "selling_price", { setValueAs: emptySafeNumber })} className={`${cell} w-20 text-right`} /></td>
                  {/* 表示価格（二重価格）。楽天 referencePrice / Yahoo original-price / Shopify compareAt。空 = 販売価格に連動 */}
                  <td className="px-1"><input type="number" {...reg(idx, "display_price", { setValueAs: emptySafeNumber })} className={`${cell} w-20 text-right`} /></td>
                  <td className="px-1">
                    <select {...reg(idx, "tax_rate", { valueAsNumber: true })} className={`${cell} bg-white`}>
                      <option value={8}>8%</option><option value={10}>10%</option>
                    </select>
                  </td>
                  <td className="px-1"><input type="number" {...reg(idx, "quantity", { setValueAs: emptySafeNumber })} className={`${cell} w-14 text-right`} /></td>
                  <td className="px-1">
                    <select {...reg(idx, "shipping_type")} className={`${cell} bg-white`}>
                      <option value="送料別">送料別</option><option value="送料無料">送料無料</option>
                    </select>
                  </td>
                  <td className="px-1"><input {...reg(idx, "postage_segment_1")} className={`${cell} w-14`} /></td>
                  <td className="px-1"><input {...reg(idx, "postage_segment_2")} className={`${cell} w-14`} /></td>
                  <td className="px-1"><input {...reg(idx, "shipping_method_group")} className={`${cell} w-24`} /></td>
                  {/* お届けの目安 = 在庫あり時納期管理番号（楽天 normalDeliveryDateId、SKU単位） */}
                  <td className="px-1"><input {...reg(idx, "normal_delivery_date_id")} className={`${cell} w-14`} /></td>
                  <td className="px-1"><input {...reg(idx, "individual_shipping_fee")} className={`${cell} w-16`} /></td>
                  <td className="px-1 text-center"><input type="checkbox" {...reg(idx, "okihai")} /></td>
                  <td className="px-1">
                    <div className="flex items-center gap-1">
                      {skuImageUrl.trim() ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={skuImageUrl} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="h-7 w-7 shrink-0 rounded bg-slate-100" />
                      )}
                      <input
                        {...reg(idx, "image_url")}
                        placeholder="https://image.rakuten.co.jp/…"
                        className={`${cell} w-52`}
                      />
                    </div>
                  </td>
                  <td className="px-1"><button type="button" onClick={() => remove(idx)} className="text-red-600 hover:underline">削除</button></td>
                </tr>
                );
              })}
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
            variation_value: "", image_url: "", shipping_type: "送料別", postage_segment_1: "", postage_segment_2: "",
            shipping_method_group: "", normal_delivery_date_id: "", individual_shipping_fee: "", okihai: true, attributes: [],
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
 * 紐付くYahooカテゴリ(yahoo_category_id / yahoo_path)と商品属性（推奨属性）を自動入力する。
 * 両者は独立して行い、片方の失敗でもう片方を止めない。属性のマージは
 * mergeGenreAttributes（既入力値を item 単位で保持する共有規則）を使う。 */
function MallCategoryField() {
  const { register, setValue, watch, getValues } = useFormContext<FormValues>();
  const [message, setMessage] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState(false);
  const lastMappedId = React.useRef<string | null>(null);
  const reg = register("mall_category_id");
  const yahooCategoryId = watch("yahoo_category_id");

  const runAutofill = async (id: string) => {
    const supabase = createClient();
    const parts: string[] = [];
    let failed = false;

    // 1) Yahooカテゴリの自動入力
    try {
      const mapping = await fetchYahooCategoryMapping(supabase, id);
      if (!mapping) {
        parts.push(`カテゴリID ${id} に対応するYahooカテゴリが見つかりませんでした`);
      } else {
        const opts = { shouldDirty: true, shouldValidate: true } as const;
        setValue("yahoo_category_id", mapping.yahoo_category_id, opts);
        setValue("yahoo_path", mapping.yahoo_path, opts);
        parts.push(`Yahooカテゴリを自動入力: ${mapping.yahoo_path || mapping.yahoo_category_id}`);
      }
    } catch (err) {
      failed = true;
      parts.push(
        "Yahooカテゴリの取得に失敗しました: " + (err instanceof Error ? err.message : String(err)),
      );
    }

    // 2) 商品属性の自動読み込み（Yahooマッピングの有無・成否に関係なく独立して行う）
    try {
      const attrs = await fetchGenreAttributes(supabase, id);
      if (attrs.length > 0) {
        const current = getValues("attributes") || [];
        const merged = mergeGenreAttributes(current, genreAttributesToInputs(attrs));
        setValue("attributes", merged, { shouldDirty: true });
        const emptyRequired = countEmptyRequiredAttributes(merged);
        parts.push(
          emptyRequired > 0
            ? `商品属性 ${merged.length}件を読み込みました（値が空の必須項目が${emptyRequired}件あります）`
            : `商品属性 ${merged.length}件を読み込みました`,
        );
      }
    } catch (err) {
      failed = true;
      parts.push(
        "商品属性の読み込みに失敗しました: " + (err instanceof Error ? err.message : String(err)),
      );
    }

    if (failed) lastMappedId.current = null; // 失敗時は再blurで再試行できるようにする
    if (parts.length > 0) setMessage(parts.join(" / "));
  };

  const autofillFromCategory = async (e: React.FocusEvent<HTMLInputElement>) => {
    const id = (e.target.value || "").trim();
    if (!id || id === lastMappedId.current) return; // 空 or 同一IDの再blurはスキップ
    lastMappedId.current = id;
    await runAutofill(id);
  };

  // 既存商品はカテゴリIDが入ったまま開かれ blur が起きないため、明示ボタンで反映できるようにする
  // （260711修正依頼-2）。ボタンは lastMappedId ガードを通さず常に再取得・上書きする。
  const applyFromButton = async () => {
    const id = (getValues("mall_category_id") || "").trim();
    if (!id) {
      setMessage("モール基本カテゴリIDを入力してください");
      return;
    }
    lastMappedId.current = id;
    setApplying(true);
    try {
      await runAutofill(id);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="mb-3">
      <Label htmlFor="mall_category_id">モール基本カテゴリID</Label>
      <div className="flex items-center gap-2">
        <Input
          id="mall_category_id"
          {...reg}
          onBlur={(e) => {
            reg.onBlur(e);
            void autofillFromCategory(e);
          }}
        />
        <Button
          type="button"
          onClick={applyFromButton}
          disabled={applying}
          variant="outline"
          className="shrink-0 whitespace-nowrap"
        >
          {applying ? "反映中…" : "Yahooカテゴリへ反映"}
        </Button>
      </div>
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
  const { register, watch } = useFormContext<FormValues>();
  const mode = watch("yahoo_variation_mode");
  const variantCount = (watch("variants") ?? []).length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <TextField name="option_item_name" label="項目選択肢項目名" />
        <TextField name="variation_key" label="バリエーション項目キー" />
        <TextField name="variation_name" label="バリエーション項目名" />
        <TextField name="variation_choices" label="選択肢定義 (パイプ区切り)" />
      </div>
      <div>
        <Label htmlFor="yahoo_variation_mode">Yahoo!への登録方式（バリエーション商品）</Label>
        <select
          id="yahoo_variation_mode"
          {...register("yahoo_variation_mode")}
          className="block w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="split">SKUごとに別商品へ分割（従来）</option>
          <option value="unified">1商品ページに統合（オプション＋サブコードで選択・在庫管理）</option>
        </select>
        {mode === "unified" && (
          <p className="mt-1 text-[11px] text-slate-500">
            親商品コードは楽天商品管理番号、サブコードは各SKUのNEコードになります。
            選択肢名は「バリエーション項目名」、各SKUの選択肢は SKU一覧の「バリエーション」列が使われます。
            {variantCount < 2 && "（SKUが2件未満のため、現在は通常の単一商品として登録されます）"}
          </p>
        )}
      </div>
    </div>
  );
}

/** 定期購入セクション。楽天と Yahoo!ショッピングは項目体系が異なる（楽天=SKU別定期価格＋
 * 日付/間隔フラグ、Yahoo=商品レベル1価格＋type/グループ/サイクル/ポイント）ため小見出しで分ける。 */
function SubscriptionSection() {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="border-b border-slate-200 pb-1 text-sm font-semibold text-slate-700">楽天</p>
        <RakutenSubscriptionFields />
      </div>
      <div className="space-y-3">
        <p className="border-b border-slate-200 pb-1 text-sm font-semibold text-slate-700">Yahoo!ショッピング</p>
        <YahooSubscriptionFields />
      </div>
    </div>
  );
}

function RakutenSubscriptionFields() {
  const { register, watch } = useFormContext<FormValues>();
  const enabled = watch("subscription_enabled");
  const variants = watch("variants") ?? [];
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" {...register("subscription_enabled")} />
        定期購入販売を有効にする（楽天）
      </label>
      {enabled ? (
        <>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("subscription_shipping_date_flag")} />
              購入者がお届け日付を指定できる
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("subscription_interval_flag")} />
              購入者がお届け間隔（曜日）を指定できる
            </label>
          </div>
          <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            日付指定・間隔指定の少なくとも一方が必要です。定期購入価格・初回価格は通常販売価格から
            <strong>5%以上の割引</strong>が必要です（登録時に検証されます）。
          </p>
          {variants.length === 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <TextField name="subscription_base_price" label="定期購入価格 (税抜・0=未設定)" type="number" />
              <TextField name="subscription_first_price" label="初回価格 (税抜・任意・0=未設定)" type="number" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500">SKUごとの定期購入価格（0 = そのSKUは通常購入のみ）</p>
              {variants.map((v, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-40 shrink-0 truncate font-mono text-xs">
                    {v?.ne_code || v?.sku_manage_number || `SKU ${i + 1}`}
                  </span>
                  <span className="text-xs text-slate-400">定期価格</span>
                  <Input
                    type="number"
                    className="max-w-28"
                    {...register(`variants.${i}.subscription_base_price` as FieldPath<FormValues>, { setValueAs: emptySafeNumber })}
                  />
                  <span className="text-xs text-slate-400">初回価格</span>
                  <Input
                    type="number"
                    className="max-w-28"
                    {...register(`variants.${i}.subscription_first_price` as FieldPath<FormValues>, { setValueAs: emptySafeNumber })}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-slate-400">
          楽天から取込むと定期購入設定（お届け日付/間隔・定期価格・初回価格）が自動で入ります。
          無効にして反映すると、楽天側の定期購入ボタンが非表示になります。
        </p>
      )}
    </div>
  );
}

/** Yahoo!ショッピングの定期購入（editItem subscription_* 5項目）。
 * 定期購入区分（type）に応じて価格・グループ・サイクル・ポイントの入力欄を表示する。
 * 価格はアプリ内税抜（送信時に税込へ変換）。おすすめサイクルは "1:日数"/"2:月数" の合成文字列を
 * 種別セレクト＋数値入力に分解して編集する。 */
function YahooSubscriptionFields() {
  const { register, watch, setValue } = useFormContext<FormValues>();
  const type = Number(watch("yahoo_subscription_type") ?? 0);
  const cycle = String(watch("yahoo_subscription_recommended_cycle") ?? "");
  const cycleMatch = /^([12]):(\d*)$/.exec(cycle);
  const cycleKind = cycleMatch ? cycleMatch[1] : "0";
  const cycleNum = cycleMatch ? cycleMatch[2] : "";
  const setCycle = (kind: string, num: string) =>
    setValue("yahoo_subscription_recommended_cycle", kind === "0" ? "" : `${kind}:${num}`, {
      shouldDirty: true,
      shouldValidate: true,
    });
  const selectCls = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <div className="space-y-3">
      <div className="mb-3">
        <Label htmlFor="yahoo_subscription_type">定期購入区分</Label>
        <select
          id="yahoo_subscription_type"
          {...register("yahoo_subscription_type", { valueAsNumber: true })}
          className={selectCls}
        >
          <option value={0}>設定なし（定期購入しない）</option>
          <option value={1}>通常購入／定期購入（併売）</option>
          <option value={2}>定期購入のみ</option>
        </select>
      </div>
      {type !== 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <TextField name="yahoo_subscription_price" label="定期購入価格 (税抜・必須)" type="number" />
            <TextField
              name="yahoo_subscription_group_index"
              label="定期購入グループ管理番号 (1〜20・必須)"
              type="number"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="mb-3">
              <Label htmlFor="yahoo_subscription_cycle_kind">おすすめサイクル</Label>
              <div className="flex items-center gap-2">
                <select
                  id="yahoo_subscription_cycle_kind"
                  className={selectCls}
                  value={cycleKind}
                  onChange={(e) => setCycle(e.target.value, cycleNum)}
                >
                  <option value="0">設定なし</option>
                  <option value="1">日ごと (10〜90日)</option>
                  <option value="2">月ごと (1〜6か月)</option>
                </select>
                {cycleKind !== "0" ? (
                  <Input
                    type="number"
                    className="max-w-24"
                    aria-label={cycleKind === "1" ? "サイクル日数" : "サイクル月数"}
                    placeholder={cycleKind === "1" ? "日数" : "月数"}
                    value={cycleNum}
                    onChange={(e) => setCycle(cycleKind, e.target.value)}
                  />
                ) : null}
              </div>
            </div>
            <TextField
              name="yahoo_subscription_point_code"
              label="定期購入ポイント倍率 (1〜15・0=未設定)"
              type="number"
            />
          </div>
          <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            {type === 2
              ? "「定期購入のみ」では定期購入価格を通常販売価格と同額にしてください。セール価格・会員価格とは併用できません。"
              : "定期購入価格は通常販売価格以下にしてください（会員価格がある場合はそれ以下）。"}
            グループ管理番号はストアクリエイタProで作成済みの定期購入グループ番号です。反映・登録時に検証されます。
          </p>
        </>
      ) : (
        <p className="text-xs text-slate-400">
          Yahoo!ショッピングから取込むと定期購入設定（区分・定期価格・グループ・サイクル・ポイント）が自動で入ります。
          「設定なし」で反映すると、Yahoo側の定期購入設定が解除されます。
        </p>
      )}
    </div>
  );
}

function ImageUrlSection({ productId }: { productId?: string }) {
  const { register, getValues, setValue, watch } = useFormContext<FormValues>();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const dragFrom = React.useRef<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  // watch で並び替え・手入力の両方に追随して再描画する
  const urls = Array.from({ length: 20 }, (_, i) =>
    String(watch(`image_url_${i + 1}` as FieldPath<FormValues>) ?? ""),
  );

  // from の行を抜いて to の位置へ挿入し、image_url_1..20 へ詰め直す（260711修正依頼-6: 任意の並び替え）
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= 20 || to >= 20) return;
    const arr = Array.from({ length: 20 }, (_, i) =>
      String(getValues(`image_url_${i + 1}` as FieldPath<FormValues>) ?? ""),
    );
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    arr.forEach((v, i) =>
      setValue(`image_url_${i + 1}` as FieldPath<FormValues>, v as never, { shouldDirty: true }),
    );
  };

  // 保存済みの並び順で画像を取得し、規約名で R-Cabinet へ上書き再アップロード + 楽天 images[] を patch 更新
  const reupload = async () => {
    if (!productId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/upload/rcabinet-sync/${productId}`, { method: "POST" });
      const json = await res.json();
      if (json.ok) {
        const n = Array.isArray(json.uploaded) ? json.uploaded.length : 0;
        setMessage(
          json.patched
            ? `${n}枚を再アップロードし、楽天商品の画像リストを更新しました`
            : `${n}枚を再アップロードしました（${json.patchError ?? ""}）`,
        );
      } else {
        const firstFail = Array.isArray(json.failed) && json.failed[0]
          ? `（例: ${json.failed[0].index}枚目 ${json.failed[0].error}）`
          : "";
        setMessage(`再アップロードに失敗しました: ${json.error ?? json.patchError ?? ""}${firstFail}`);
      }
    } catch (e) {
      setMessage("再アップロードに失敗しました: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-400">
        ⠿ をドラッグ（または ↑↓）で並び替えできます。「再アップロード」は保存済みの並びで実行されます（自動保存後に実行してください）。
      </p>
      <div className="grid grid-cols-2 gap-2">
        {urls.map((url, idx) => (
          <div
            key={idx}
            className={cn(
              "rounded border p-1.5",
              dragOver === idx ? "border-blue-400 bg-blue-50" : "border-slate-200",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOver !== idx) setDragOver(idx);
            }}
            onDragLeave={() => setDragOver((cur) => (cur === idx ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              if (dragFrom.current != null) move(dragFrom.current, idx);
              dragFrom.current = null;
            }}
          >
            <div className="flex items-center gap-1">
              <span
                draggable
                onDragStart={() => {
                  dragFrom.current = idx;
                }}
                className="cursor-grab select-none px-0.5 text-slate-400"
                title="ドラッグで並び替え"
                aria-label={`画像 URL ${idx + 1} を並び替え`}
              >
                ⠿
              </span>
              <Label htmlFor={`image_url_${idx + 1}`} className="mb-0">
                画像 URL {idx + 1}
              </Label>
              <span className="ml-auto flex gap-0.5">
                <button
                  type="button"
                  onClick={() => move(idx, idx - 1)}
                  disabled={idx === 0}
                  className="rounded border border-slate-200 px-1 text-xs text-slate-500 disabled:opacity-30"
                  aria-label="上へ"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, idx + 1)}
                  disabled={idx === 19}
                  className="rounded border border-slate-200 px-1 text-xs text-slate-500 disabled:opacity-30"
                  aria-label="下へ"
                >
                  ↓
                </button>
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              {url.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-9 w-9 shrink-0 rounded bg-slate-100" />
              )}
              <Input id={`image_url_${idx + 1}`} {...register(`image_url_${idx + 1}` as FieldPath<FormValues>)} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" onClick={reupload} disabled={busy || !productId} variant="outline">
          {busy ? "再アップロード中…" : "⟳ 並び順で画像を再アップロード（楽天）"}
        </Button>
        {!productId && (
          <span className="text-xs text-slate-400">商品を保存すると実行できます</span>
        )}
      </div>
      {message && <p className="text-xs text-blue-700">{message}</p>}
    </div>
  );
}

/** 白背景画像（楽天 whiteBgImage、商品全体で1枚）。プレビュー＋URL入力欄
 * （楽天RMS商品編集画面の「白背景画像」セクションと同じ構成）。
 * 「画像アップロード」パネルで種別「白背景 (wb01)」をアップロードすると、
 * このURLへ自動反映される（ImageUploadPanel → notifyWhiteBgImageUploaded）。 */
function WhiteBgImageSection() {
  const { register, watch } = useFormContext<FormValues>();
  const url = String(watch("white_bg_image_url") ?? "");
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        楽天の白背景画像（商品全体で1枚）です。R-Cabinet の公開画像URLを入力してください。
        右の「画像アップロード」パネルで種別「白背景 (wb01)」をアップロードすると自動で入ります。
      </p>
      <div className="flex items-start gap-3">
        {url.trim() ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="白背景画像プレビュー"
            className="h-24 w-24 shrink-0 rounded border border-slate-200 bg-white object-contain"
          />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 text-[11px] text-slate-400">
            未設定
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Label htmlFor="white_bg_image_url">画像URL</Label>
          <Input
            id="white_bg_image_url"
            placeholder="https://image.rakuten.co.jp/…/cabinet/wb01/wb-xxxx.jpg"
            {...register("white_bg_image_url")}
          />
        </div>
      </div>
    </div>
  );
}

type AttrRow = { item: string; value: string; unit: string; requirement: string };

/** 属性(item/value/unit)の編集リスト本体。編集対象（商品共通 or 各SKU）ごとに
 * name（"attributes" または "variants.{idx}.attributes"）を切り替えて使う。
 * react-hook-form の useFieldArray は name を動的に切り替えられないため、
 * 呼び出し側で name を key に付けて再マウントする（AttributeSection 参照）。 */
function AttributeEditor({ name }: { name: string }) {
  const { control, register, watch } = useFormContext<FormValues>();
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: name as FieldArrayPath<FormValues>,
  });
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const categoryId = watch("mall_category_id");
  // 空の必須項目の常時通知（カテゴリblurの自動読み込み・手動読み込みのどちらでも効く）
  const attributesValue = watch(name as FieldPath<FormValues>) as AttrRow[] | undefined;
  const emptyRequiredCount = countEmptyRequiredAttributes(attributesValue ?? []);

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
      // （マージ規則は一括登録の自動補完と共有の mergeGenreAttributes を使う = 単一実装）
      const current = (watch(name as FieldPath<FormValues>) as AttrRow[] | undefined) || [];
      const next = mergeGenreAttributes(current, genreAttributesToInputs(attrs));
      replace(next as never);
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

      {emptyRequiredCount > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          ⚠ 値が空の必須項目が{emptyRequiredCount}件あります（楽天は必須属性が空だと登録に失敗します）
        </p>
      )}

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
          const requirement = watch(`${name}.${idx}.requirement` as FieldPath<FormValues>) as
            | string
            | undefined;
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
                  <Input
                    aria-label={`属性${idx + 1} 項目`}
                    {...register(`${name}.${idx}.item` as FieldPath<FormValues>)}
                  />
                  {required && (
                    <span className="shrink-0 text-[10px] font-bold text-rose-700 bg-rose-200 rounded px-1 py-0.5">
                      必須
                    </span>
                  )}
                </div>
              </div>
              <div>
                {idx === 0 && <Label>値</Label>}
                <Input
                  aria-label={`属性${idx + 1} 値`}
                  {...register(`${name}.${idx}.value` as FieldPath<FormValues>)}
                />
              </div>
              <div>
                {idx === 0 && <Label>単位</Label>}
                <Input
                  aria-label={`属性${idx + 1} 単位`}
                  {...register(`${name}.${idx}.unit` as FieldPath<FormValues>)}
                />
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
        onClick={() => append({ item: "", value: "", unit: "", requirement: "" } as never)}
      >
        + 項目を追加
      </Button>
    </div>
  );
}

/** 商品属性セクション。単品(variants未設定)は従来どおり商品共通の属性のみを編集する。
 * 複数SKU(variants.length > 0)のときは「商品共通」と各SKUを切り替えて属性(item/value/unit)を
 * 編集でき、「次へ →」で対象を移動、「📋 コピー」「📥 貼り付け」で対象間の属性値を複製できる。
 * （多くの属性はSKU間で共通で、総入数など一部だけ違う運用のため。楽天は各SKUに必須属性が
 * 無いと登録に失敗するため、空のSKUは反映時に商品共通の属性へフォールバックする。） */
export function AttributeSection() {
  const { watch, getValues, setValue } = useFormContext<FormValues>();
  const variants = (watch("variants") ?? []) as {
    ne_code?: string;
    sku_manage_number?: string;
    variation_value?: string;
  }[];
  const count = variants.length;
  const hasVariants = count > 0;

  const [target, setTarget] = React.useState<"product" | number>("product");
  const [clipboard, setClipboard] = React.useState<AttrRow[] | null>(null);
  const [pasteNonce, setPasteNonce] = React.useState(0);

  // SKU削除等で選択中のインデックスが範囲外になった場合は、商品共通として扱う。
  const activeTarget = typeof target === "number" && target >= count ? "product" : target;

  // 単品(variants未設定)は従来どおり商品共通のみ。切り替え/コピー貼り付けUIは出さない。
  if (!hasVariants) {
    return <AttributeEditor name="attributes" />;
  }

  const name =
    activeTarget === "product" ? "attributes" : `variants.${activeTarget}.attributes`;
  const skuLabel = (i: number) => {
    const v = variants[i];
    return (
      v?.variation_value?.trim() ||
      v?.ne_code?.trim() ||
      v?.sku_manage_number?.trim() ||
      `SKU ${i + 1}`
    );
  };
  const currentLabel =
    activeTarget === "product" ? "商品共通" : skuLabel(activeTarget);

  const goPrev = () =>
    setTarget(
      activeTarget === "product"
        ? count - 1
        : activeTarget === 0
          ? "product"
          : activeTarget - 1,
    );
  const goNext = () =>
    setTarget(
      activeTarget === "product"
        ? 0
        : activeTarget >= count - 1
          ? "product"
          : activeTarget + 1,
    );

  const cloneRows = (rows: AttrRow[] | undefined): AttrRow[] =>
    (rows ?? []).map((a) => ({
      item: a.item ?? "",
      value: a.value ?? "",
      unit: a.unit ?? "",
      requirement: a.requirement ?? "",
    }));

  const copyCurrent = () =>
    setClipboard(cloneRows(getValues(name as FieldPath<FormValues>) as AttrRow[] | undefined));
  const pasteHere = () => {
    if (!clipboard) return;
    setValue(name as FieldPath<FormValues>, cloneRows(clipboard) as never, { shouldDirty: true });
    setPasteNonce((n) => n + 1); // 貼り付け後の値で現在の対象を再マウントして反映する
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-600">編集対象:</span>
          <button
            type="button"
            onClick={() => setTarget("product")}
            className={cn(
              "rounded border px-2 py-1 text-xs",
              activeTarget === "product"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-300 bg-white text-slate-600",
            )}
          >
            商品共通
          </button>
          {variants.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setTarget(i)}
              className={cn(
                "rounded border px-2 py-1 text-xs",
                activeTarget === i
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-300 bg-white text-slate-600",
              )}
            >
              {skuLabel(i)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={goPrev}>
            ← 前へ
          </Button>
          <span className="text-xs text-slate-700">{`編集中: ${currentLabel}`}</span>
          <Button type="button" variant="outline" onClick={goNext}>
            次へ →
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={copyCurrent}>
            📋 コピー
          </Button>
          <Button type="button" variant="outline" onClick={pasteHere} disabled={!clipboard}>
            📥 貼り付け
          </Button>
          {clipboard && (
            <span className="text-xs text-slate-500">
              コピー済み {clipboard.length}件（対象を切り替えて貼り付けできます）
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          総入数など一部だけ違う場合は、共通の属性をコピーして各SKUに貼り付け、違う項目だけ直してください。
        </p>
      </div>
      <AttributeEditor key={`${name}:${pasteNonce}`} name={name} />
    </div>
  );
}
