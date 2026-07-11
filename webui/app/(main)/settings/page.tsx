import { HelpLink } from "@/components/help/HelpLink";

export default function SettingsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">設定</h1>
        <HelpLink anchor="screen-settings" />
      </div>
      <p className="text-sm text-slate-500 mt-2">Plan 5 で実装予定</p>
    </div>
  );
}
