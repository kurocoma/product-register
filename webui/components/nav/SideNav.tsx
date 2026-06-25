"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "ダッシュボード", icon: "🏠" },
  { href: "/products", label: "商品一覧", icon: "📦" },
  { href: "/products/new", label: "商品編集", icon: "✏️" },
  { href: "/csv", label: "CSV ダウンロード", icon: "📥" },
  { href: "/templates", label: "テンプレート管理", icon: "📋" },
  { href: "/masters", label: "マスタ取込", icon: "🗄" },
  { href: "/masters/related", label: "関連商品抽出", icon: "🔎" },
  { href: "/history", label: "作業履歴", icon: "🕒" },
  { href: "/settings", label: "設定", icon: "⚙️" },
  { href: "/help", label: "ヘルプ", icon: "❓" },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="w-56 bg-slate-900 text-white min-h-screen p-4 flex flex-col">
      <div className="font-bold text-lg mb-6 px-2">商品登録アプリ</div>
      <ul className="space-y-1 flex-1">
        {items.map((item) => {
          const active =
            (item.href === "/" && pathname === "/") ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors",
                  active ? "bg-blue-600" : "hover:bg-slate-800",
                )}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <form action="/auth/signout" method="post" className="mt-8 px-2">
        <button type="submit" className="text-sm text-slate-400 hover:text-white">
          ログアウト
        </button>
      </form>
    </nav>
  );
}
