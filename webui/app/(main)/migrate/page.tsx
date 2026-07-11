import { MigratePanel } from "@/components/product/MigratePanel";
import { HelpLink } from "@/components/help/HelpLink";

export default function MigratePage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">楽天 → Yahoo 一括移行</h1>
        <HelpLink anchor="screen-migrate" />
      </div>
      <p className="text-sm text-slate-500">
        楽天の商品管理番号リストから商品を取得し、Yahoo!ショッピングへ一括で移行登録します。
        まずプレビュー(dry-run)で判定を確認してから実行してください。
      </p>
      <MigratePanel />
    </div>
  );
}
