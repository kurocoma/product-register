"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { upsertProduct } from "@/lib/product/repository";
import type { ProductInput } from "@/lib/product/schema";
import { ProductForm } from "./ProductForm";
import { useAutoSave } from "@/hooks/useAutoSave";
import { Button } from "@/components/ui/button";

export function ProductEditView({
  initial,
  productId,
}: {
  initial: ProductInput;
  productId?: string; // 新規ならundefined
}) {
  const router = useRouter();
  const [currentId, setCurrentId] = useState(productId);
  const [data, setData] = useState<ProductInput>(initial);

  const save = useCallback(
    async (v: ProductInput) => {
      const supabase = createClient();
      const saved = await upsertProduct(supabase, v, currentId);
      if (!currentId) {
        setCurrentId(saved.id);
        // 新規作成後は URL を更新
        router.replace(`/products/${saved.id}`);
      }
    },
    [currentId, router],
  );

  const { status, savedAt, manualSave } = useAutoSave(data, save, 800);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <div className="text-xs text-slate-500">商品編集</div>
          <div className="font-mono text-sm">
            [{currentId ? data.ne_code : "新規商品"}]
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AutoSaveIndicator status={status} savedAt={savedAt} />
          <Button onClick={manualSave} variant="outline">
            💾 保存
          </Button>
        </div>
      </div>

      {/* 本体: 左フォーム + 右プレビュー (Plan 4 で実装) */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-2/5 overflow-y-auto p-4 border-r border-slate-200">
          <ProductForm defaultValues={initial} onChange={setData} />
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
          <div className="text-sm text-slate-500 mb-2">
            プレビュー (Plan 4 で実装)
          </div>
          <div className="bg-white border border-slate-200 rounded p-4 text-sm text-slate-600">
            <div className="font-semibold">{data.display_name || "(商品名未入力)"}</div>
            <div className="mt-2">価格: ¥{data.selling_price.toLocaleString()}</div>
            <div className="mt-2 text-xs">
              NEコード: {data.ne_code} / JAN: {data.jan_code}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AutoSaveIndicator({
  status,
  savedAt,
}: {
  status: string;
  savedAt: Date | null;
}) {
  if (status === "saving") return <span className="text-slate-500 text-sm">保存中…</span>;
  if (status === "error") return <span className="text-red-600 text-sm">⚠ 保存失敗</span>;
  if (savedAt) {
    return (
      <span className="text-green-700 text-sm">
        ✓ 自動保存済み {savedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  }
  return <span className="text-slate-400 text-sm">未保存</span>;
}
