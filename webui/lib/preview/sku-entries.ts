import type { ProductInput, Variant } from "@/lib/product/schema";
import { productVariants } from "@/lib/product/schema";

/** プレビューの SKU 切替リストの1件。page 共通フィールドは p、SKU 単位は v を参照する。 */
export type SkuEntry = { p: ProductInput; v: Variant };

type Options = { peerFilter?: (p: ProductInput) => boolean };

function collectMembers(
  product: ProductInput,
  peers: ProductInput[],
  peerFilter?: (p: ProductInput) => boolean,
): ProductInput[] {
  return [
    product,
    ...peers.filter((pp) => pp.ne_code !== product.ne_code && (peerFilter?.(pp) ?? true)),
  ];
}

/** variant の ne_code 単位で重複排除（先勝ち = product 側優先）。 */
function dedupeByNeCode(entries: SkuEntry[]): SkuEntry[] {
  const seen = new Set<string>();
  const out: SkuEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.v.ne_code)) continue;
    seen.add(e.v.ne_code);
    out.push(e);
  }
  return out;
}

/** プレビューの SKU 切替リストを組み立てる（楽天/Shopify 用）。
 * 各商品の variants[] を展開し（フラット商品は1件合成＝従来の peers 挙動と同等）、
 * ne_code で重複排除して quantity 昇順に並べる。 */
export function buildSkuEntries(
  product: ProductInput,
  peers: ProductInput[],
  opts: Options = {},
): SkuEntry[] {
  const members = collectMembers(product, peers, opts.peerFilter);
  const entries = members.flatMap((pp) => productVariants(pp).map((v) => ({ p: pp, v })));
  return dedupeByNeCode(entries).sort((a, b) => a.v.quantity - b.v.quantity);
}

/** 商品ごとに variants[0] を代表として1エントリだけ返す（Yahoo 用。
 * Yahoo の多SKUは subcode_param で将来対応のため、掲載単位=商品で扱う）。 */
export function buildRepresentativeEntries(
  product: ProductInput,
  peers: ProductInput[],
  opts: Options = {},
): SkuEntry[] {
  const members = collectMembers(product, peers, opts.peerFilter);
  const entries = members.map((pp) => ({ p: pp, v: productVariants(pp)[0] }));
  return dedupeByNeCode(entries).sort((a, b) => a.v.quantity - b.v.quantity);
}
