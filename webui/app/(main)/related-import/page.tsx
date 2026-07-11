import { RelatedImportSearch } from "@/components/product/RelatedImportSearch";
import { HelpLink } from "@/components/help/HelpLink";

export default function RelatedImportPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">関連商品（セット）をモールから取込</h1>
        <HelpLink anchor="screen-related-import" />
      </div>
      <p className="text-sm text-slate-500">
        値上げ対象の単品コード/JANから、それを構成に含むセット商品を NEマスタ で探し、
        楽天/Yahoo の商品コードを使ってアプリへ取り込みます。
      </p>
      <RelatedImportSearch />
    </div>
  );
}
