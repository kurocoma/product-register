import { RelatedSearchPanel } from "@/components/masters/RelatedSearchPanel";
import { HelpLink } from "@/components/help/HelpLink";

export default function RelatedPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">関連商品抽出（値上げ連動）</h1>
        <HelpLink anchor="screen-masters-related" />
      </div>
      <p className="text-sm text-slate-500">
        値上げ対象の単品コード/JANを貼り付けると、その単品を構成に含む<strong>セット商品</strong>を一覧します。
        セットの構成品・販売価格・モール別コードを確認し、まとめて値上げするためのCSVをダウンロードできます。
        モール別コードが無いセットは「紐づけ漏れ」として表示します。
      </p>
      <RelatedSearchPanel />
    </div>
  );
}
