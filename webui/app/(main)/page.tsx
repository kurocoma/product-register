import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">ダッシュボード</h1>
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="商品数" value={0} />
        <StatCard title="本日編集" value={0} accent />
        <StatCard title="CSV 出力" value={0} />
        <StatCard title="未対応アラート" value={0} warning />
      </div>
      <p className="text-sm text-slate-500">
        Plan 5 で実データ反映 (最近編集 / アラート / CSV出力履歴)
      </p>
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
