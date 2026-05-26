import type { ProductInput } from "@/lib/product/schema";

export const ENCODING = {
  rakuten: "cp932",
  ne: "utf-8",
  yahoo: "cp932",
  shopify: "utf-8-sig",
} as const;

export type Encoding = typeof ENCODING[keyof typeof ENCODING];
export type MallName = keyof typeof ENCODING;

export interface Converter<TOutput = Record<string, string>> {
  mallName: MallName;
  encoding: Encoding;
  convert(products: ProductInput[]): TOutput[] | { singles: TOutput[]; sets: TOutput[] };
}
