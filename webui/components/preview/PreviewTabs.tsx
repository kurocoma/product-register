"use client";

import * as React from "react";
import type { ProductInput } from "@/lib/product/schema";
import { cn } from "@/lib/utils";
import { RakutenPreview } from "./RakutenPreview";
import { YahooPreview } from "./YahooPreview";
import { ShopifyPreview } from "./ShopifyPreview";

type MallTab = "rakuten" | "yahoo" | "shopify";
export type PreviewDevice = "pc" | "sp";

export function PreviewTabs({
  product,
  peers,
}: {
  product: ProductInput;
  peers: ProductInput[];
}) {
  const [tab, setTab] = React.useState<MallTab>("rakuten");
  // 実モールページの PC / スマホ の構成差（実ページ実測）を切り替えて確認する
  const [device, setDevice] = React.useState<PreviewDevice>("pc");

  return (
    <div className="space-y-3">
      <div className="flex items-center border-b border-slate-200">
        <TabButton active={tab === "rakuten"} onClick={() => setTab("rakuten")}>
          楽天
        </TabButton>
        <TabButton active={tab === "yahoo"} onClick={() => setTab("yahoo")}>
          Yahoo
        </TabButton>
        <TabButton active={tab === "shopify"} onClick={() => setTab("shopify")}>
          Shopify
        </TabButton>
        <div className="ml-auto flex items-center gap-1 pb-1 text-xs">
          <DeviceButton active={device === "pc"} onClick={() => setDevice("pc")}>
            🖥 PC
          </DeviceButton>
          <DeviceButton active={device === "sp"} onClick={() => setDevice("sp")}>
            📱 スマホ
          </DeviceButton>
        </div>
      </div>
      {tab === "rakuten" && <RakutenPreview product={product} peers={peers} device={device} />}
      {tab === "yahoo" && <YahooPreview product={product} peers={peers} device={device} />}
      {tab === "shopify" && <ShopifyPreview product={product} peers={peers} device={device} />}
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

function DeviceButton({
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
        "rounded border px-2 py-1 transition-colors",
        active
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700",
      )}
    >
      {children}
    </button>
  );
}
