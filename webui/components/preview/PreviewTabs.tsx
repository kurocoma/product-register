"use client";

import * as React from "react";
import type { ProductInput } from "@/lib/product/schema";
import { cn } from "@/lib/utils";
import { RakutenPreview } from "./RakutenPreview";
import { YahooPreview } from "./YahooPreview";
import { ShopifyPreview } from "./ShopifyPreview";

type MallTab = "rakuten" | "yahoo" | "shopify";

export function PreviewTabs({
  product,
  peers,
}: {
  product: ProductInput;
  peers: ProductInput[];
}) {
  const [tab, setTab] = React.useState<MallTab>("rakuten");

  return (
    <div className="space-y-3">
      <div className="flex border-b border-slate-200">
        <TabButton active={tab === "rakuten"} onClick={() => setTab("rakuten")}>
          楽天
        </TabButton>
        <TabButton active={tab === "yahoo"} onClick={() => setTab("yahoo")}>
          Yahoo
        </TabButton>
        <TabButton active={tab === "shopify"} onClick={() => setTab("shopify")}>
          Shopify
        </TabButton>
      </div>
      {tab === "rakuten" && <RakutenPreview product={product} peers={peers} />}
      {tab === "yahoo" && <YahooPreview product={product} peers={peers} />}
      {tab === "shopify" && <ShopifyPreview product={product} peers={peers} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
        active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700",
      )}
    >
      {children}
    </button>
  );
}
