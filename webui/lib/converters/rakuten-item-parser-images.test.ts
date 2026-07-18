import { describe, it, expect } from "vitest";
import { parseRakutenItem, parseRakutenVariants } from "./rakuten-item-parser";

/** items.get レスポンスの最小 fixture（docs/楽天/items.get.txt の実例構造に準拠）。 */
const baseItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: "テスト商品",
  variants: {
    "t002-2542-1": {
      merchantDefinedSkuId: "t002-2542-1",
      standardPrice: "10000",
    },
  },
  ...over,
});

describe("parseRakutenItem 白背景画像(whiteBgImage)の取込", () => {
  it("CABINET の whiteBgImage を公開URLへ変換して white_bg_image_url に取り込む", () => {
    const out = parseRakutenItem(
      baseItem({ whiteBgImage: { type: "CABINET", location: "/wb01/wb-t002-2542.jpg" } }),
    );
    expect(out.white_bg_image_url).toBe(
      "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/wb01/wb-t002-2542.jpg",
    );
  });

  it("GOLD の whiteBgImage は gold ドメインの公開URLへ変換する", () => {
    const out = parseRakutenItem(
      baseItem({ whiteBgImage: { type: "GOLD", location: "/wb/white.jpg" } }),
    );
    expect(out.white_bg_image_url).toBe(
      "https://www.rakuten.ne.jp/gold/ichiban-okinawa/wb/white.jpg",
    );
  });

  it("whiteBgImage が無い場合も white_bg_image_url を常に空文字で設定する（モール現状を正とし、解除も往復できる）", () => {
    const out = parseRakutenItem(baseItem());
    expect(out.white_bg_image_url).toBe("");
  });

  it("whiteBgImage の location が空なら空文字（不正値を取り込まない）", () => {
    const out = parseRakutenItem(baseItem({ whiteBgImage: { type: "CABINET", location: "" } }));
    expect(out.white_bg_image_url).toBe("");
  });
});

describe("parseRakutenVariants SKU画像(variants.{}.images)の取込", () => {
  it("variant の images[0] を公開URLへ変換して image_url に取り込む", () => {
    const vs = parseRakutenVariants(
      baseItem({
        variants: {
          "n050-3419-1": {
            merchantDefinedSkuId: "n050-3419-1",
            standardPrice: "1637",
            images: [{ type: "CABINET", location: "/thum02/n050-3419-1.jpg", alt: "sku-image" }],
          },
        },
      }),
    );
    expect(vs).toHaveLength(1);
    expect(vs[0].image_url).toBe(
      "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/n050-3419-1.jpg",
    );
  });

  it("images の無い variant は image_url 未設定（SKU画像なし）", () => {
    const vs = parseRakutenVariants(
      baseItem({
        variants: {
          "n050-3419-1": { merchantDefinedSkuId: "n050-3419-1", standardPrice: "1637" },
        },
      }),
    );
    expect(vs[0].image_url).toBeUndefined();
  });

  it("複数 variant で画像の有無が独立して取り込まれる", () => {
    const vs = parseRakutenVariants(
      baseItem({
        variants: {
          "a-1": {
            merchantDefinedSkuId: "a-1",
            standardPrice: "1000",
            images: [{ type: "CABINET", location: "/thum02/a-1.jpg" }],
          },
          "a-2": { merchantDefinedSkuId: "a-2", standardPrice: "2000" },
        },
      }),
    );
    const byCode = Object.fromEntries(vs.map((v) => [v.ne_code, v]));
    expect(byCode["a-1"].image_url).toBe(
      "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/a-1.jpg",
    );
    expect(byCode["a-2"].image_url).toBeUndefined();
  });

  it("GOLD の SKU画像は gold ドメインの公開URLへ変換する", () => {
    const vs = parseRakutenVariants(
      baseItem({
        variants: {
          "g-1": {
            merchantDefinedSkuId: "g-1",
            standardPrice: "1000",
            images: [{ type: "GOLD", location: "/sku/g-1.jpg" }],
          },
        },
      }),
    );
    expect(vs[0].image_url).toBe("https://www.rakuten.ne.jp/gold/ichiban-okinawa/sku/g-1.jpg");
  });
});
