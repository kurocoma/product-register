import { buildRakutenImageUrls } from "@/lib/converters/image-url";
import type { ProductInput } from "@/lib/product/schema";

const IMAGE_URL_KEYS = Array.from(
  { length: 20 },
  (_, index) => `image_url_${index + 1}` as `image_url_${number}`,
);

export const RULE_VIOLATION_REASONS = {
  descriptionHtml: "description_html",
  imageNaming: "image_naming",
} as const;

export type RuleViolationReason =
  (typeof RULE_VIOLATION_REASONS)[keyof typeof RULE_VIOLATION_REASONS];

export type RuleAuditProduct = Pick<
  ProductInput,
  "ne_code" | "maker_code" | "jan_code" | "sale_description_pc"
> &
  Partial<Record<`image_url_${number}`, string>>;

export type RuleViolationResult = {
  violated: boolean;
  reasons: RuleViolationReason[];
};

function imageFileName(url: string): string {
  const path = url.trim().split(/[?#]/, 1)[0].replaceAll("\\", "/");
  const encodedName = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

/** 商品の販売説明文・楽天基準の画像命名規則からの逸脱を副作用なしで判定する。 */
export function detectRuleViolation(product: RuleAuditProduct): RuleViolationResult {
  const reasons: RuleViolationReason[] = [];

  if (product.sale_description_pc !== "") {
    reasons.push(RULE_VIOLATION_REASONS.descriptionHtml);
  }

  const baseCode = `${product.maker_code}-${product.jan_code.slice(-4)}`;
  const expectedNames = buildRakutenImageUrls(baseCode, product.ne_code, IMAGE_URL_KEYS.length)
    .map(imageFileName);
  const hasImageNamingViolation = IMAGE_URL_KEYS.some((key, index) => {
    const imageUrl = product[key]?.trim() ?? "";
    return imageUrl !== "" && imageFileName(imageUrl) !== expectedNames[index];
  });

  if (hasImageNamingViolation) {
    reasons.push(RULE_VIOLATION_REASONS.imageNaming);
  }

  return { violated: reasons.length > 0, reasons };
}
