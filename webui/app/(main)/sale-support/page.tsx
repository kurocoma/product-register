import { createClient } from "@/lib/supabase/server";
import { listSsCopies, type SsCopyListItem } from "@/lib/sale-support";
import { SaleSupportPanel } from "@/components/sale-support/SaleSupportPanel";
import { HelpLink } from "@/components/help/HelpLink";

export default async function SaleSupportPage() {
  // 復元タブの初期データは Server Component で取得して initial* props で渡す
  // （ProductList / HistoryView と同じ踏襲。再読込はクライアントから GET ルート）。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let initialCopies: SsCopyListItem[] = [];
  if (user) {
    try {
      initialCopies = await listSsCopies(supabase, user.id);
    } catch {
      initialCopies = []; // 取得失敗時は空で開き、タブ内の再読込で回復できる
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">セール支援（楽天スーパーセール）</h1>
        <HelpLink anchor="screen-sale-support" />
      </div>
      <p className="text-sm text-slate-500">
        楽天の商品管理番号リストから、元価格の控え（-SS 倉庫コピー）を作った上で
        値引き・二重価格・販売期間を一括適用します。セール後は「復元」タブで -SS コピーから元に戻せます。
        まずプレビューで計算結果を確認してから実行してください。
      </p>
      <SaleSupportPanel initialCopies={initialCopies} />
    </div>
  );
}
