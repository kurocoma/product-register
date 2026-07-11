import { BulkImageUploader } from "@/components/bulk-images/BulkImageUploader";

export default function BulkImagesPage() {
  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold">画像一括アップロード</h1>
      <p className="mb-4 text-sm text-slate-500">
        画像をドラッグ&ドロップで取り込み、並び替えて、楽天 R-Cabinet / Yahoo（商品画像・追加画像）/ Shopify へまとめてアップロードします。
      </p>
      <BulkImageUploader />
    </div>
  );
}
