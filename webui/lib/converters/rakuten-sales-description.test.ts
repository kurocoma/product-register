import { describe, it, expect } from "vitest";
import { parseRakutenItem } from "./rakuten-item-parser";
import { buildRakutenUpsertBody } from "./rakuten-api";
import { makeProduct } from "../product/schema";

/** 260711修正依頼-3「PC用販売説明文も正確に取り込めるように。IMGソースの部分も取り込んでOK」の回帰テスト。
 * 取込: salesDescription → sale_description_pc（生HTML保持）。
 * 反映: sale_description_pc があればそれを salesDescription へ送る（往復対称）。 */

const IMG_HTML =
  '<CENTER>\n<img src="https://image.rakuten.co.jp/ichiban-okinawa/cabinet/shimanoya-sub/r135-10-1_1.jpg" width="700">\n</CENTER>';

describe("parseRakutenItem — salesDescription の取込", () => {
  it("imgタグ含む任意HTMLを加工せずそのまま sale_description_pc へ", () => {
    const out = parseRakutenItem({ title: "X", salesDescription: IMG_HTML });
    expect(out.sale_description_pc).toBe(IMG_HTML);
  });
  it("salesDescription が無ければ sale_description_pc を設定しない", () => {
    const out = parseRakutenItem({ title: "X" });
    expect(out.sale_description_pc).toBeUndefined();
  });
  it("反映時に前置された販売説明文を description_sp から剥がす（往復で二重化しない）", () => {
    const out = parseRakutenItem({
      title: "X",
      salesDescription: IMG_HTML,
      productDescription: { pc: "PC説明", sp: IMG_HTML + "スマホ本文" },
    });
    expect(out.description_sp).toBe("スマホ本文");
    expect(out.description_pc).toBe("PC説明");
  });
  it("sp が販売説明文で始まらない場合はそのまま保持", () => {
    const out = parseRakutenItem({
      title: "X",
      salesDescription: IMG_HTML,
      productDescription: { sp: "独立したスマホ本文" },
    });
    expect(out.description_sp).toBe("独立したスマホ本文");
  });
});

describe("buildRakutenUpsertBody — sale_description_pc の反映（往復対称）", () => {
  it("sale_description_pc があれば salesDescription にそれを送る", () => {
    const p = makeProduct({ ne_code: "r135-10-1", sale_description_pc: IMG_HTML, description_sp: "スマホ本文" });
    const body = buildRakutenUpsertBody(p);
    expect(body.salesDescription).toBe(IMG_HTML);
    // スマホ用説明文は CSV 出力(rakuten.ts)と同じく 販売説明文 + description_sp の前置合成
    expect((body.productDescription as { sp?: string }).sp).toBe(IMG_HTML + "スマホ本文");
  });
  it("sale_description_pc が空なら従来どおり imgList を自動生成して送る", () => {
    const p = makeProduct({ ne_code: "r135-10-1", sale_description_pc: "", image_count: 2 });
    const body = buildRakutenUpsertBody(p);
    expect(String(body.salesDescription)).toContain("<img");
  });
});
