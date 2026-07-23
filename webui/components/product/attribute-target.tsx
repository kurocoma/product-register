"use client";

import * as React from "react";

/** 「商品属性」「楽天SKU自由入力行」で共有する編集対象。"product"=商品共通、数値=variants のインデックス。 */
export type AttributeTarget = "product" | number;

type AttributeTargetValue = {
  target: AttributeTarget;
  setTarget: (t: AttributeTarget) => void;
};

const AttributeTargetContext = React.createContext<AttributeTargetValue | null>(null);

/** 商品属性セクションと自由入力行セクションの「編集対象（商品共通/SKU）」を連動させる Provider。
 * ProductForm の「商品属性 (5)」アコーディオン内で両セクションを包む。 */
export function AttributeTargetProvider({
  children,
  initialTarget = "product",
}: {
  children: React.ReactNode;
  initialTarget?: AttributeTarget;
}) {
  const [target, setTarget] = React.useState<AttributeTarget>(initialTarget);
  const value = React.useMemo(() => ({ target, setTarget }), [target]);
  return <AttributeTargetContext.Provider value={value}>{children}</AttributeTargetContext.Provider>;
}

/** 編集対象の共有 state。Provider の外（単体テスト等）ではローカル state に自動フォールバックする。 */
export function useAttributeTarget(): AttributeTargetValue {
  const ctx = React.useContext(AttributeTargetContext);
  const [localTarget, setLocalTarget] = React.useState<AttributeTarget>("product");
  if (ctx) return ctx;
  return { target: localTarget, setTarget: setLocalTarget };
}
