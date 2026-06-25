"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { upsertProduct } from "@/lib/product/repository";
import type { ProductInput } from "@/lib/product/schema";
import { ProductForm } from "./ProductForm";
import { useAutoSave } from "@/hooks/useAutoSave";
import { Button } from "@/components/ui/button";
import { PreviewTabs } from "@/components/preview/PreviewTabs";
import { CsvDownloadPanel } from "@/components/csv/CsvDownloadPanel";
import { ImageUploadPanel } from "./ImageUploadPanel";
import { RegisterPanel } from "./RegisterPanel";
import { MallEditPanel } from "./MallEditPanel";
import { MallRelatedImportPanel } from "./MallRelatedImportPanel";

export function ProductEditView({
  initial,
  productId,
  peers,
}: {
  initial: ProductInput;
  productId?: string;
  peers?: ProductInput[];
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
        router.replace(`/products/${saved.id}`);
      }
    },
    [currentId, router],
  );

  const { status, savedAt, errorMessage, manualSave } = useAutoSave(data, save, 800);

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

      {/* 保存エラーのバナー（NEコード必須・重複など） */}
      {status === "error" && errorMessage && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          ⚠ 保存できませんでした: {errorMessage}
        </div>
      )}

      {/* 本体: 左フォーム + 右プレビュー */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-2/5 overflow-y-auto p-4 border-r border-slate-200">
          <ProductForm defaultValues={initial} onChange={setData} />
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-3">
          <PreviewTabs product={data} peers={peers ?? []} />
          <ImageUploadPanel productId={currentId} />
          <RegisterPanel productId={currentId} />
          <MallEditPanel productId={currentId} />
          <MallRelatedImportPanel neCode={currentId ? data.ne_code : undefined} />
          <CsvDownloadPanel productId={currentId} />
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
