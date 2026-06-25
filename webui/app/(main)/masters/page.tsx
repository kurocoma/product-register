import { MasterImportPanel } from "@/components/masters/MasterImportPanel";

export default function MastersPage() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">マスタ取込</h1>
      <p className="text-sm text-slate-500">
        NE（商品・セット・紐づけ）と Excel（商品マスタ・モール別コード）を取り込み、
        <code>ne_code</code> をスパインに統合した参照用マスタDBを更新します。
        値上げ連動の関連商品抽出（Phase 2）の土台になります。
      </p>
      <MasterImportPanel />
    </div>
  );
}
