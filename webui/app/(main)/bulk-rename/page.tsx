import { SaleNamePanel } from "@/components/bulk-tools/SaleNamePanel";
import { HelpLink } from "@/components/help/HelpLink";

export default function BulkRenamePage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">商品名セール文言</h1>
        <HelpLink anchor="screen-bulk-rename" />
      </div>
      <p className="text-sm text-slate-500">
        セール文言を商品名の先頭に一括追記します（例: 【スーパーセール10%OFF】）。
        文字数レギュレーション（楽天255バイト・Yahoo全角75字）違反の商品は自動で除外して警告します。
        セール終了後は同じ文言で「解除」を実行すると元の商品名に戻ります。
      </p>
      <SaleNamePanel />
    </div>
  );
}
