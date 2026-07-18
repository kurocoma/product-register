import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { buildRakutenUpsertBody, cabinetLocationFromUrl } from "./rakuten-api";

type Variants = Record<string, Record<string, unknown>>;
const variantsOf = (p: Parameters<typeof buildRakutenUpsertBody>[0]) =>
  buildRakutenUpsertBody(p).variants as Variants;

/** 多SKUテスト用の共通 variants（既存 rakuten-api-multisku.test.ts と同じ2SKU構成）。 */
const twoVariants = (aImage: string, bImage: string) => [
  { sku_manage_number: "n050-3419-1", ne_code: "n050-3419-1", jan_code: "4582469493419", selling_price: 1637, tax_rate: 10 as const, quantity: 1, shipping_type: "送料無料", image_url: aImage },
  { sku_manage_number: "n050-3419-s01", ne_code: "n050-3419-s01", jan_code: "4582469493426", selling_price: 3120, tax_rate: 10 as const, quantity: 1, shipping_type: "送料別", postage_segment_1: "1", image_url: bImage },
];

describe("cabinetLocationFromUrl (URL→location 変換)", () => {
  it("R-Cabinet 公開URLから /cabinet 以降の画像パスを抽出する", () => {
    expect(
      cabinetLocationFromUrl("https://image.rakuten.co.jp/ichiban-okinawa/cabinet/wb01/wb-t002-2542.jpg"),
    ).toBe("/wb01/wb-t002-2542.jpg");
  });

  it("既に /パス 形式ならそのまま返す", () => {
    expect(cabinetLocationFromUrl("/thum02/t002-2542-1.jpg")).toBe("/thum02/t002-2542-1.jpg");
  });

  it("クエリ付きURL（サムネイル指定等）はクエリを除去して抽出する", () => {
    expect(
      cabinetLocationFromUrl("https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/a.jpg?_ex=128x128"),
    ).toBe("/thum02/a.jpg");
  });

  it("空・cabinet 公開URLでない値は null（送信対象外）", () => {
    expect(cabinetLocationFromUrl("")).toBeNull();
    expect(cabinetLocationFromUrl(undefined)).toBeNull();
    expect(cabinetLocationFromUrl("https://example.com/a.jpg")).toBeNull();
    expect(cabinetLocationFromUrl("https://www.rakuten.ne.jp/gold/ichiban-okinawa/a.jpg")).toBeNull();
  });
});

describe("buildRakutenUpsertBody 白背景画像(whiteBgImage)", () => {
  it("白背景画像URL(公開URL)が設定されていれば whiteBgImage を正しい構造で組み立てる", () => {
    const p = makeProduct({
      white_bg_image_url: "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/wb01/wb-t002-2542.jpg",
    });
    const body = buildRakutenUpsertBody(p);
    expect(body.whiteBgImage).toEqual({ type: "CABINET", location: "/wb01/wb-t002-2542.jpg" });
  });

  it("白背景画像URLが /パス 形式でもそのまま location に使う", () => {
    const p = makeProduct({ white_bg_image_url: "/wb01/wb-t002-2542.jpg" });
    const body = buildRakutenUpsertBody(p);
    expect(body.whiteBgImage).toEqual({ type: "CABINET", location: "/wb01/wb-t002-2542.jpg" });
  });

  it("白背景画像URLが空なら whiteBgImage キー自体を付けない", () => {
    const body = buildRakutenUpsertBody(makeProduct());
    expect("whiteBgImage" in body).toBe(false);
  });

  it("cabinet 公開URLでない値（外部URL）は whiteBgImage を付けない", () => {
    const p = makeProduct({ white_bg_image_url: "https://example.com/white.jpg" });
    const body = buildRakutenUpsertBody(p);
    expect("whiteBgImage" in body).toBe(false);
  });
});

describe("buildRakutenUpsertBody SKU管理画像(variants.{}.images)", () => {
  it("多SKUで画像URLが設定された variant に images を正しい構造で入れる（alt=掲載商品名）", () => {
    const p = makeProduct({
      variants: twoVariants("https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/n050-3419-1.jpg", ""),
    });
    const vs = variantsOf(p);
    expect(vs["n050-3419-1"].images).toEqual([
      {
        type: "CABINET",
        location: "/thum02/n050-3419-1.jpg",
        alt: "巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度",
      },
    ]);
  });

  it("画像URLの無い variant には images キー自体を付けない", () => {
    const p = makeProduct({ variants: twoVariants("", "") });
    const vs = variantsOf(p);
    expect("images" in vs["n050-3419-1"]).toBe(false);
    expect("images" in vs["n050-3419-s01"]).toBe(false);
  });

  it("複数variantで画像URLの有無が独立して扱われる", () => {
    const p = makeProduct({
      variants: twoVariants("", "/thum02/n050-3419-s01.jpg"),
    });
    const vs = variantsOf(p);
    expect("images" in vs["n050-3419-1"]).toBe(false);
    expect(vs["n050-3419-s01"].images).toEqual([
      {
        type: "CABINET",
        location: "/thum02/n050-3419-s01.jpg",
        alt: "巨人 GIANTSボトル 10年貯蔵古酒 720ml 25度",
      },
    ]);
  });

  it("単一SKU（バリエーションなし）には SKU画像を送らない（CSV経路と同じ楽天制約）", () => {
    const p = makeProduct({
      variants: [
        { sku_manage_number: "a", ne_code: "a", jan_code: "4582469493419", selling_price: 500, tax_rate: 10, quantity: 1, shipping_type: "送料無料", image_url: "/thum02/a.jpg" },
      ],
    });
    const vs = variantsOf(p);
    expect("images" in vs["a"]).toBe(false);
  });

  it("既存の商品レベル images（画像枚数由来の組み立て）は変わらない", () => {
    const p = makeProduct({
      image_count: 2,
      white_bg_image_url: "/wb01/wb-t002-2542.jpg",
      variants: twoVariants("/thum02/n050-3419-1.jpg", ""),
    });
    const body = buildRakutenUpsertBody(p);
    expect(body.images).toEqual([
      { type: "CABINET", location: "/thum02/t002-2542-1.jpg" },
      { type: "CABINET", location: "/thum02/t002-2542_2.jpg" },
    ]);
  });
});
