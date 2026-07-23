"use client";

import * as React from "react";
import { useFormContext, useWatch, type FieldPath } from "react-hook-form";
import type { ProductInputBase } from "@/lib/product/schema";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAttributeTarget } from "./attribute-target";

/** RMSの自由入力行はSKUごとに最大5行。常に5枠を表示する（商品属性と同じ見た目）。 */
const SLOT_COUNT = 5;

type SpecRow = { label: string; value: string };

const emptyRow = (): SpecRow => ({ label: "", value: "" });

const cloneRows = (rows: SpecRow[] | undefined): SpecRow[] =>
  (rows ?? []).map((r) => ({ label: r.label ?? "", value: r.value ?? "" }));

/** 保存済み specs（0〜5行）を表示用の5枠へ広げる。 */
function padToSlots(saved: SpecRow[] | undefined): SpecRow[] {
  const rows = cloneRows(saved);
  while (rows.length < SLOT_COUNT) rows.push(emptyRow());
  return rows.slice(0, SLOT_COUNT);
}

/** 表示5枠のうち「項目・値の両方が入力済み」の行だけが保存対象（schema が両方必須のため）。 */
function completeRows(rows: SpecRow[]): SpecRow[] {
  return rows.filter((r) => r.label !== "" && r.value !== "");
}

/** 楽天SKUの「属性情報自由入力行」を編集する小コンポーネント。
 * 表示するSKUは商品属性セクションの「編集対象」と連動する（AttributeTargetProvider 経由）。
 * 表示は常に5枠（ローカルstate）、フォームへは完成行のみを書き込む。空枠や片側だけの
 * 入力途中行をフォームに入れない（zod検証・自動保存を汚さない）ための設計。 */
export function VariantSpecsEditor() {
  const { watch, getValues, setValue } = useFormContext<ProductInputBase>();
  const variants = watch("variants") ?? [];
  const { target } = useAttributeTarget();
  const [clipboard, setClipboard] = React.useState<SpecRow[] | null>(null);
  if (variants.length === 0) return null;

  // SKU削除等で選択中のインデックスが範囲外になった場合は商品共通として扱う（AttributeSection と同じ規則）。
  const count = variants.length;
  const activeTarget = typeof target === "number" && target >= count ? "product" : target;
  const isSku = activeTarget !== "product";

  const skuLabel = (i: number) => {
    const v = variants[i];
    return (
      v?.ne_code?.trim() ||
      v?.sku_manage_number?.trim() ||
      v?.variation_value?.trim() ||
      `SKU ${i + 1}`
    );
  };
  const specsName = (i: number) => `variants.${i}.specs` as FieldPath<ProductInputBase>;

  const copyCurrent = () => {
    if (!isSku) return;
    setClipboard(cloneRows(getValues(specsName(activeTarget)) as SpecRow[] | undefined));
  };
  const pasteHere = () => {
    if (!isSku || !clipboard) return;
    setValue(specsName(activeTarget), cloneRows(clipboard) as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <section className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3" aria-label="楽天SKU自由入力行">
      <div>
        <p className="text-sm font-medium text-slate-700">楽天SKU 自由入力行</p>
        <p className="text-xs text-slate-500">
          RMSの「自由入力行（項目／値）」です。SKUごとに最大5行（項目40文字・値140文字）。項目と値の両方を入力した行だけが保存されます。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={copyCurrent} disabled={!isSku}>
          📋 コピー
        </Button>
        <Button type="button" variant="outline" onClick={pasteHere} disabled={!isSku || !clipboard}>
          📥 貼り付け
        </Button>
        {clipboard && (
          <span className="text-xs text-slate-500">
            コピー済み {clipboard.length}件（編集対象を切り替えて貼り付けできます）
          </span>
        )}
      </div>
      {isSku ? (
        <VariantSpecSlots key={activeTarget} variantIndex={activeTarget} skuLabel={skuLabel(activeTarget)} />
      ) : (
        <p className="text-xs text-slate-500">
          自由入力行はSKUごとの設定です。上の「編集対象」でSKUを選ぶと編集できます。
        </p>
      )}
    </section>
  );
}

function VariantSpecSlots({ variantIndex, skuLabel }: { variantIndex: number; skuLabel: string }) {
  const { control, setValue } = useFormContext<ProductInputBase>();
  const name = `variants.${variantIndex}.specs` as FieldPath<ProductInputBase>;
  const saved = useWatch({ control, name }) as SpecRow[] | undefined;
  const savedKey = JSON.stringify((saved ?? []).map((r) => [r.label, r.value]));

  const [rows, setRows] = React.useState<SpecRow[]>(() => padToSlots(saved));

  // 取込・貼り付け等でフォーム側の specs が外から変わったら表示枠を作り直す
  // （レンダー中の状態調整パターン）。自分の書き込み後は completeRows(rows) と
  // 一致するため再初期化されない（入力途中行を保持）。
  const [prevSavedKey, setPrevSavedKey] = React.useState(savedKey);
  if (savedKey !== prevSavedKey) {
    setPrevSavedKey(savedKey);
    if (JSON.stringify(completeRows(rows).map((r) => [r.label, r.value])) !== savedKey) {
      setRows(padToSlots(saved));
    }
  }

  const commit = (nextRows: SpecRow[]) => {
    setRows(nextRows);
    const complete = completeRows(nextRows);
    const currentKey = JSON.stringify((saved ?? []).map((r) => [r.label, r.value]));
    if (JSON.stringify(complete.map((r) => [r.label, r.value])) !== currentKey) {
      setValue(name, complete as never, { shouldDirty: true, shouldValidate: true });
    }
  };

  const update = (slot: number, field: keyof SpecRow, value: string) =>
    commit(rows.map((r, i) => (i === slot ? { ...r, [field]: value } : r)));

  const clear = (slot: number) => commit(rows.map((r, i) => (i === slot ? emptyRow() : r)));

  return (
    <fieldset className="space-y-2 rounded border border-slate-200 bg-white p-2">
      <legend className="px-1 text-xs font-semibold text-slate-700">{skuLabel}</legend>
      <div className="space-y-2">
        {rows.map((row, slot) => {
          const halfFilled = (row.label === "") !== (row.value === "");
          return (
            <div key={slot} className="grid grid-cols-[1fr_1.5fr_auto] items-end gap-2 border-t pt-2 first:border-t-0 first:pt-0">
              <div>
                {slot === 0 && <Label>項目</Label>}
                <Input
                  aria-label={`${skuLabel} 自由入力行${slot + 1} 項目`}
                  maxLength={40}
                  placeholder="項目（40文字まで）"
                  value={row.label}
                  onChange={(e) => update(slot, "label", e.target.value)}
                />
              </div>
              <div>
                {slot === 0 && <Label>値</Label>}
                <Input
                  aria-label={`${skuLabel} 自由入力行${slot + 1} 値`}
                  maxLength={140}
                  placeholder="値（140文字まで）"
                  value={row.value}
                  onChange={(e) => update(slot, "value", e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => clear(slot)}
                aria-label={`${skuLabel} 自由入力行${slot + 1}を削除`}
                className="pb-2 text-xs text-red-600 hover:underline"
              >
                削除
              </button>
              {halfFilled && (
                <p className="col-span-3 text-[11px] text-amber-700">
                  項目と値の両方を入力すると保存されます
                </p>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
