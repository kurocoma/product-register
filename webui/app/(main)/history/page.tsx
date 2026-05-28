import { createClient } from "@/lib/supabase/server";

const ACTION_LABEL: Record<string, string> = {
  create: "新規作成",
  edit: "編集",
  delete: "削除",
  csv_export: "CSV 出力",
};

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">作業履歴</h1>
      <p className="text-sm text-slate-500">直近 100 件</p>

      <div className="bg-white rounded border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">日時</th>
              <th className="px-3 py-2">操作</th>
              <th className="px-3 py-2">商品コード</th>
              <th className="px-3 py-2">詳細</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  履歴がありません
                </td>
              </tr>
            ) : (
              data.map((h) => {
                const detail = (h.detail as Record<string, unknown>) ?? {};
                return (
                  <tr key={h.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-xs">
                      {new Date(h.created_at).toLocaleString("ja-JP")}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {ACTION_LABEL[h.action] ?? h.action}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {String(detail.ne_code ?? "—")}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {h.action === "csv_export"
                        ? `${(detail.malls as string[] | undefined)?.join("/") ?? ""} (${detail.productCount ?? 0}商品)`
                        : ""}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
