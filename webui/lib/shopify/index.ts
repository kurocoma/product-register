// Shopify Admin GraphQL クライアント層の公開境界（barrel）。
// 他機能からは "@/lib/shopify" 経由で import する（内部ファイル直 import は段階的に廃止）。
export * from "./auth";
export * from "./graphql-client";
export * from "./inventory-client";
export * from "./media-client";
export * from "./product-client";
