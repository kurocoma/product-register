// 共有ドメイン核: ProductInput / Variant スキーマ（正本は lib/product/schema.ts）。
// 位置を確定させるための薄い re-export。型・フィールド・default は一切変更しない。
// 新規コードはここ（@/lib/shared/schema）を import してよい。既存 import の一括書換はしない。
export * from "../product/schema";
