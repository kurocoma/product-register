"use client";

import { useState } from "react";
import type { SsCopyListItem } from "@/lib/sale-support/copies";
import { SaleApplyTab } from "./SaleApplyTab";
import { SaleRestoreTab } from "./SaleRestoreTab";

/** セール支援のタブ定義。将来「JAN抽出」「お知らせ追記」等（壁打ち機能1〜3）を
 * ここへ追加できる構成にしている（タブ＝機能単位）。 */
const TABS = [
  { id: "apply", label: "🏷 セール適用" },
  { id: "restore", label: "↩ 復元（-SSコピーから）" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SaleSupportPanel({ initialCopies }: { initialCopies: SsCopyListItem[] }) {
  const [tab, setTab] = useState<TabId>("apply");

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "rounded-t border border-b-0 border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700"
                : "rounded-t px-4 py-2 text-sm text-slate-500 hover:text-slate-800"
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "apply" ? <SaleApplyTab /> : <SaleRestoreTab initialCopies={initialCopies} />}
    </div>
  );
}
