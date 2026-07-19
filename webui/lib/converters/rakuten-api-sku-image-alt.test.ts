/** SKU管理画像 alt の HTML 無害化（IE0218 対策）のテスト。
 * 背景（r3001-1 実件）: display_name に <br> が入っており（楽天の商品名運用で一般的）、
 * SKU画像 alt にそのまま使われて items.upsert が
 * 「IE0218: HTML not allowed in variants.*.images[0].alt」で全滅した。
 * 対策1: alt はタグ・山括弧を除去した平文にする（plainTextAlt）。
 * 対策2: validateUpsertBody が alt 内の HTML を送信前に検出する（防御の多層化）。 */
import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { buildRakutenUpsertBody, plainTextAlt, validateUpsertBody } from "./rakuten-api";

describe("plainTextAlt（alt 用の平文化）", () => {
  it("<br> タグをスペースに置き換える（r3001-1 実件の形）", () => {
    expect(
      plainTextAlt("にんにく醪酢 540mg×62球（約1ヵ月分）<br>しまのや もろみ 酢"),
    ).toBe("にんにく醪酢 540mg×62球（約1ヵ月分） しまのや もろみ 酢");
  });

  it("任意のタグ（属性付き含む）を除去し、連続スペースを1つに畳む", () => {
    expect(plainTextAlt('a<br/>b<img src="x">c')).toBe("a b c");
  });

  it("山括弧で囲まれた区間はタグとして除去し、平文だけ残す", () => {
    expect(plainTextAlt("a < b > c")).toBe("a c");
  });

  it("全角の＜＞は HTML ではないので残す", () => {
    expect(plainTextAlt("＜栄養機能食品（鉄）＞")).toBe("＜栄養機能食品（鉄）＞");
  });

  it("前後の空白は除去し、タグだけなら空文字になる", () => {
    expect(plainTextAlt("  x  ")).toBe("x");
    expect(plainTextAlt("<br>")).toBe("");
    expect(plainTextAlt(undefined)).toBe("");
  });
});

describe("buildRakutenUpsertBody: SKU画像 alt の無害化", () => {
  const twoVariants = [
    { sku_manage_number: "r3001-1", ne_code: "r3001-1", jan_code: "4582469493419", selling_price: 1637, tax_rate: 10 as const, quantity: 1, shipping_type: "送料無料", image_url: "/thum02/r3001-1.jpg", variation_value: "1袋" },
    { sku_manage_number: "r3001-3", ne_code: "r3001-3", jan_code: "4582469493426", selling_price: 3120, tax_rate: 10 as const, quantity: 3, shipping_type: "送料無料", image_url: "/thum02/r3001-3.jpg", variation_value: "3袋" },
  ];

  it("display_name の <br> が alt から除去されて送られる", () => {
    const p = makeProduct({
      display_name: "にんにく醪酢 540mg×62球（約1ヵ月分）<br>しまのや もろみ 酢",
      variants: twoVariants,
    });
    const vs = buildRakutenUpsertBody(p).variants as Record<string, { images?: { alt?: string }[] }>;
    const alt = vs["r3001-1"].images?.[0]?.alt ?? "";
    expect(alt).toBe("にんにく醪酢 540mg×62球（約1ヵ月分） しまのや もろみ 酢");
    expect(/[<>]/.test(alt)).toBe(false);
  });

  it("HTML を除去すると空になる display_name では alt キー自体を付けない", () => {
    const p = makeProduct({ display_name: "<br>", variants: twoVariants });
    const vs = buildRakutenUpsertBody(p).variants as Record<string, { images?: Record<string, unknown>[] }>;
    expect("alt" in (vs["r3001-1"].images?.[0] ?? {})).toBe(false);
  });
});

describe("validateUpsertBody: alt 内 HTML の送信前検出（防御の多層化）", () => {
  const baseBody = (alt: string) => ({
    title: "t",
    itemType: "NORMAL",
    genreId: "123456",
    variants: {
      "r3001-1": {
        standardPrice: "1637",
        images: [{ type: "CABINET", location: "/thum02/r3001-1.jpg", alt }],
      },
    },
  });

  it("alt に山括弧（HTML）が残っていれば必須不足として検出する", () => {
    const res = validateUpsertBody("r3001-1", baseBody("にんにく<br>酢"));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.missing.some((m) => m.includes("IE0218"))).toBe(true);
      expect(res.missing.some((m) => m.includes("r3001-1"))).toBe(true);
    }
  });

  it("平文 alt なら従来どおり ok", () => {
    expect(validateUpsertBody("r3001-1", baseBody("にんにく醪酢 しまのや"))).toEqual({ ok: true });
  });
});
