import { JanPricePanel } from "@/components/bulk-tools/JanPricePanel";
import { HelpLink } from "@/components/help/HelpLink";

export default function BulkPricePage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">JAN売価変更</h1>
        <HelpLink anchor="screen-bulk-price" />
      </div>
      <p className="text-sm text-slate-500">
        JANコードから単品・セット商品（SKU含む）を抽出し、新しい税抜価格を入力して
        アプリDB → 楽天 → Yahoo へ一括反映します。まずプレビューで対象と税込換算を確認してください。
      </p>
      <JanPricePanel />
    </div>
  );
}
