"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: string };
type NavGroup = { heading?: string; items: NavItem[] };

// ユーザー目的で6グループに整理（docs/architecture-audit/03-ux-navigation.md §4.2）。
// URL は一切変更しない。ナビの見せ方（グルーピングとラベル）のみ再編。
const groups: NavGroup[] = [
  {
    items: [{ href: "/", label: "ダッシュボード", icon: "🏠" }],
  },
  {
    heading: "商品",
    items: [
      { href: "/products", label: "商品一覧", icon: "📦" },
      { href: "/products/new", label: "新規作成", icon: "✏️" },
    ],
  },
  {
    heading: "一括作業",
    items: [
      { href: "/bulk-register", label: "一括登録", icon: "🗂" },
      { href: "/bulk-images", label: "画像一括アップロード", icon: "🖼" },
      { href: "/csv", label: "CSV ダウンロード", icon: "📥" },
      { href: "/migrate", label: "楽天→Yahoo 一括移行", icon: "🚚" },
    ],
  },
  {
    heading: "取込・関連付け",
    items: [
      { href: "/related-import", label: "関連商品（セット）取込", icon: "🧩" },
      { href: "/masters", label: "マスタ取込", icon: "🗄" },
      { href: "/masters/related", label: "関連商品抽出", icon: "🔎" },
    ],
  },
  {
    heading: "品質・監査",
    items: [
      { href: "/rule-audit", label: "ルール監査", icon: "🧭" },
      { href: "/links/shimanoya", label: "しまのや リンク一覧（公開）", icon: "🔗" },
    ],
  },
  {
    heading: "その他",
    items: [
      { href: "/templates", label: "テンプレート管理", icon: "📋" },
      { href: "/history", label: "作業履歴", icon: "🕒" },
      { href: "/settings", label: "設定", icon: "⚙️" },
      { href: "/help", label: "ヘルプ", icon: "❓" },
    ],
  },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="w-56 bg-slate-900 text-white min-h-screen p-4 flex flex-col">
      <div className="font-bold text-lg mb-6 px-2">商品登録アプリ</div>
      <div className="flex-1 space-y-4">
        {groups.map((group, gi) => (
          <div key={group.heading ?? `group-${gi}`}>
            {group.heading && (
              <div className="px-3 mb-1 text-[11px] font-semibold tracking-wider text-slate-500">
                {group.heading}
              </div>
            )}
            <ul className="space-y-1">
              {group.items.map((item) => {
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
          </div>
        ))}
      </div>
      <form action="/auth/signout" method="post" className="mt-8 px-2">
        <button type="submit" className="text-sm text-slate-400 hover:text-white">
          ログアウト
        </button>
      </form>
    </nav>
  );
}
