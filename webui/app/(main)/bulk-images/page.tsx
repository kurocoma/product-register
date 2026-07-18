import { BulkImageUploader } from "@/components/bulk-images/BulkImageUploader";
import { HelpLink } from "@/components/help/HelpLink";

export default function BulkImagesPage() {
  return (
    <div className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-xl font-bold">画像一括アップロード</h1>
        <HelpLink anchor="screen-bulk-images" />
      </div>
      <p className="mb-4 text-sm text-slate-500">
        画像をドラッグ&ドロップで取り込み、並び替えて、楽天 R-Cabinet / Yahoo（商品画像・追加画像）/ Shopify へまとめてアップロードします。
      </p>
      <BulkImageUploader />
    </div>
  );
}
