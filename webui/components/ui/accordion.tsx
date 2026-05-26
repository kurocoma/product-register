"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type AccordionContextValue = {
  open: Set<string>;
  toggle: (key: string) => void;
};

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

export function Accordion({
  defaultOpen = [],
  className,
  children,
}: {
  defaultOpen?: string[];
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<Set<string>>(new Set(defaultOpen));
  const toggle = React.useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  return (
    <AccordionContext.Provider value={{ open, toggle }}>
      <div className={cn("space-y-2", className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({
  value,
  title,
  children,
}: {
  value: string;
  title: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) throw new Error("AccordionItem must be inside Accordion");
  const isOpen = ctx.open.has(value);
  return (
    <div className="border border-slate-200 rounded bg-white">
      <button
        type="button"
        onClick={() => ctx.toggle(value)}
        className="w-full flex items-center justify-between px-4 py-2 text-left text-sm font-semibold hover:bg-slate-50"
      >
        <span>{title}</span>
        <span className="text-slate-400">{isOpen ? "▼" : "▶"}</span>
      </button>
      {isOpen && <div className="px-4 py-3 border-t border-slate-100">{children}</div>}
    </div>
  );
}
