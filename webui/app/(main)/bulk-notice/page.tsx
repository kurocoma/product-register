import { NoticePanel } from "@/components/bulk-tools/NoticePanel";
import { HelpLink } from "@/components/help/HelpLink";

export default function BulkNoticePage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">お知らせ一括追記</h1>
        <HelpLink anchor="screen-bulk-notice" />
      </div>
      <p className="text-sm text-slate-500">
        営業日・休業のお知らせ等を、商品説明文（楽天PC販売説明文 / PC商品説明文 / スマホ説明文）の
        冒頭または末尾へ一括追記します。追記部分は目印マーカーで囲まれるため、「解除」タブから一括で外せます。
        変更はアプリDB → 楽天 → Yahoo の順に反映します。
      </p>
      <NoticePanel />
    </div>
  );
}
