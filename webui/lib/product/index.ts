// 商品ドメイン（スキーマ・永続化・グリッド・カテゴリ支援）の公開境界（barrel）。
// API ルート・他機能からは "@/lib/product" 経由で import する。
// 注意: クライアントコンポーネントは必要な純モジュール（schema 等）を直 import のままでよい
// （barrel 経由だと全モジュールがバンドルに入るため。段階移行中の経過措置）。
export * from "./bulk-save";
export * from "./category-assist";
export * from "./category-autofill";
export * from "./category-mapping";
export * from "./diff";
export * from "./genre-attributes";
export * from "./grid-rows";
export * from "./html-sanitize";
export * from "./new-product-checklist";
export * from "./repository";
export * from "./research-import";
export * from "./schema";
export * from "./search";
export * from "./shipping-mapping";
export * from "./text-fit";
export * from "./yahoo-split";
