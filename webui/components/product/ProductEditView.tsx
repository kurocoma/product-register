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
import { NewProductChecklist } from "./NewProductChecklist";
import { TemplateSaveButton } from "./TemplateSaveButton";
import { canAutoSaveNewProduct } from "@/lib/product/new-product-checklist";
import { HelpLink } from "@/components/help/HelpLink";

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

  // 新規作成時のみ: NEコード(保存の必須)が入るまで自動保存を開始しない
  // （空のNEコードで保存エラーを出し続けない）。既存商品の編集は従来どおり常時自動保存。
  const isNewEntry = !productId;
  const autoSaveEnabled = !!currentId || canAutoSaveNewProduct(data);
  const { status, savedAt, errorMessage, manualSave } = useAutoSave(data, save, 800, {
    enabled: autoSaveEnabled,
  });

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            商品編集
            <HelpLink anchor="screen-product-edit" />
          </div>
          <div className="font-mono text-sm">
            [{currentId ? data.ne_code : "新規商品"}]
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AutoSaveIndicator status={status} savedAt={savedAt} draft={!autoSaveEnabled} />
          <TemplateSaveButton data={data} />
          <Button onClick={manualSave} variant="outline">
            💾 保存
          </Button>
        </div>
      </div>

      {/* 新規作成時のみ: 登録ステップ + 必須項目チェック（既存商品の編集画面には出さない） */}
      {isNewEntry && <NewProductChecklist data={data} saved={!!currentId} />}

      {/* 保存エラーのバナー（NEコード必須・重複など）。数秒おきに自動リトライしつつ手動再試行もできる */}
      {status === "error" && errorMessage && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          <span>⚠ 保存できませんでした: {errorMessage}（数秒おきに自動で再試行します）</span>
          <button
            type="button"
            onClick={manualSave}
            className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            🔄 今すぐ保存し直す
          </button>
        </div>
      )}

      {/* 本体: 左フォーム + 右プレビュー */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-2/5 overflow-y-auto p-4 border-r border-slate-200">
          <ProductForm defaultValues={initial} onChange={setData} productId={currentId} />
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-3">
          {/* 反映系（画像アップ・モール登録・取込編集・CSV）はプレビューの上に置く（プレビューが長く下まで届きにくいため） */}
          <ImageUploadPanel productId={currentId} />
          <RegisterPanel productId={currentId} />
          <MallEditPanel productId={currentId} />
          <CsvDownloadPanel productId={currentId} />
          <PreviewTabs product={data} peers={peers ?? []} />
        </div>
      </div>
    </div>
  );
}

function AutoSaveIndicator({
  status,
  savedAt,
  draft,
}: {
  status: string;
  savedAt: Date | null;
  /** 新規作成でNEコード未入力のため自動保存を待機している状態。 */
  draft?: boolean;
}) {
  if (draft) {
    return (
      <span className="text-amber-600 text-sm">下書き（NEコードを入力すると自動保存が始まります）</span>
    );
  }
  if (status === "saving") return <span className="text-slate-500 text-sm">保存中…</span>;
  if (status === "error")
    return <span className="text-red-600 text-sm">⚠ 保存失敗（自動で再試行します）</span>;
  if (savedAt) {
    return (
      <span className="text-green-700 text-sm">
        ✓ 自動保存済み {savedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  }
  return <span className="text-slate-400 text-sm">未保存</span>;
}
