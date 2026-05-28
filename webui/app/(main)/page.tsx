import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [
    { count: totalProducts },
    { count: todayEdits },
    { count: csvExports },
    { data: noImageRows },
    { data: noCategoryRows },
    { data: recentEdits },
    { data: recentCsv },
  ] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase
      .from("history")
      .select("*", { count: "exact", head: true })
      .in("action", ["edit", "create"])
      .gte("created_at", todayIso),
    supabase
      .from("history")
      .select("*", { count: "exact", head: true })
      .eq("action", "csv_export")
      .gte("created_at", todayIso),
    supabase.from("products").select("id, ne_code").eq("image_count", 0),
    supabase.from("products").select("id, ne_code").or("mall_category_id.eq.,yahoo_category_id.eq."),
    supabase
      .from("history")
      .select("created_at, action, detail, product_id")
      .in("action", ["edit", "create"])
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("history")
      .select("created_at, detail")
      .eq("action", "csv_export")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const alerts = [
    ...(noImageRows ?? []).map((r) => ({
      type: "🖼️ 画像未アップロード",
      ne_code: (r as { ne_code: string }).ne_code,
    })),
    ...(noCategoryRows ?? []).map((r) => ({
      type: "📂 カテゴリ未設定",
      ne_code: (r as { ne_code: string }).ne_code,
    })),
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">ダッシュボード</h1>

      <div className="grid grid-cols-4 gap-4">
        <StatCard title="商品数" value={totalProducts ?? 0} />
        <StatCard title="本日編集" value={todayEdits ?? 0} accent />
        <StatCard title="CSV出力" value={csvExports ?? 0} />
        <StatCard title="未対応アラート" value={alerts.length} warning />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近の編集</CardTitle>
          </CardHeader>
          <CardContent>
            {(!recentEdits || recentEdits.length === 0) ? (
              <p className="text-sm text-slate-400">編集履歴がありません</p>
            ) : (
              <ul className="text-sm space-y-1">
                {recentEdits.map((h, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <span className="font-mono text-xs text-slate-500">
                      {new Date(h.created_at).toLocaleTimeString("ja-JP", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="flex-1 ml-3">
                      {(h.detail as { ne_code?: string })?.ne_code ?? "(no code)"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {h.action === "create" ? "新規作成" : "編集"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">アラート</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="text-sm text-slate-400">対応すべきアラートはありません</p>
            ) : (
              <ul className="text-sm space-y-1">
                {alerts.slice(0, 5).map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span>{a.type}</span>
                    <Link
                      href={`/products`}
                      className="text-blue-600 hover:underline font-mono text-xs"
                    >
                      {a.ne_code}
                    </Link>
                  </li>
                ))}
                {alerts.length > 5 && (
                  <li className="text-xs text-slate-400">他 {alerts.length - 5} 件</li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CSV 出力履歴</CardTitle>
        </CardHeader>
        <CardContent>
          {(!recentCsv || recentCsv.length === 0) ? (
            <p className="text-sm text-slate-400">CSV 出力履歴がありません</p>
          ) : (
            <ul className="text-sm space-y-1">
              {recentCsv.map((h, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-500">
                    {new Date(h.created_at).toLocaleString("ja-JP")}
                  </span>
                  <span className="text-xs">
                    {(h.detail as { mall?: string })?.mall ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  accent,
  warning,
}: {
  title: string;
  value: number;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-slate-600">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "text-3xl font-bold",
            accent && "text-orange-500",
            warning && "text-red-600",
            !accent && !warning && "text-blue-700",
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
