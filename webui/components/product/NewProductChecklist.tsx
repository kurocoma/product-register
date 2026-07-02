"use client";

import type { ProductInput } from "@/lib/product/schema";
import { newProductChecklist, missingRequiredItems } from "@/lib/product/new-product-checklist";

/** 新規商品登録の「登録ステップ + 必須項目チェック」パネル。
 * 新規作成時（/products/new から入ったとき）だけ表示し、既存商品の編集画面には出さない。
 * 何を入力すれば保存→モール登録に進めるかを具体的に案内する。 */
export function NewProductChecklist({ data, saved }: { data: ProductInput; saved: boolean }) {
  const items = newProductChecklist(data);
  const missing = missingRequiredItems(data);
  const stepDone = (step: number) => items.filter((i) => i.step === step && i.required).every((i) => i.done);
  const optionalStepDone = (step: number) => items.filter((i) => i.step === step).every((i) => i.done);

  const steps = [
    { no: 1, label: "基本情報", done: stepDone(1) },
    { no: 2, label: "価格", done: stepDone(2) },
    { no: 3, label: "カテゴリ・属性", done: stepDone(3) },
    { no: 4, label: "画像（任意）", done: optionalStepDone(4) },
    { no: 5, label: "保存", done: saved },
    { no: 6, label: "モール登録", done: false },
  ];

  const neCodeMissing = missing.some((i) => i.key === "ne_code");

  return (
    <div className="border-b border-slate-200 bg-sky-50 px-6 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-700">📋 登録ステップ:</span>
        {steps.map((s) => (
          <span
            key={s.no}
            className={`rounded-full border px-2 py-0.5 ${
              s.done
                ? "border-green-300 bg-green-50 text-green-700"
                : "border-slate-300 bg-white text-slate-500"
            }`}
          >
            {s.done ? "✓" : s.no}. {s.label}
          </span>
        ))}
      </div>

      {missing.length > 0 ? (
        <div className="text-sm text-amber-800">
          <span className="font-medium">あと {missing.length} 項目: </span>
          {missing.map((i) => i.label).join("、")} を入力すると保存・モール登録に進めます
          {neCodeMissing && (
            <div className="mt-1 text-xs text-slate-600">
              💡 NEコードを入力するまでは下書き扱いです（自動保存は始まりません。エラーも出ません）
            </div>
          )}
          {!neCodeMissing && (
            <div className="mt-1 text-xs text-slate-600">
              💡 NEコード入力済みのため自動保存は動いています。残りの項目はモール登録に必要です
            </div>
          )}
        </div>
      ) : saved ? (
        <div className="text-sm text-green-700">
          ✓ 必須項目がそろい保存済みです。右の「🚀 モールAPI登録」から楽天/Yahooへ登録できます
          （送信前に「登録内容を確認」で不足がないか再確認されます）
        </div>
      ) : (
        <div className="text-sm text-green-700">
          ✓ 必須項目はそろいました。自動保存の完了を待つか、右上の「💾 保存」を押してください
        </div>
      )}
    </div>
  );
}
