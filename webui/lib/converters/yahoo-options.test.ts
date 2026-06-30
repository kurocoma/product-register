import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { YahooConverter } from "./yahoo";

const opt = (p: ReturnType<typeof makeProduct>) => new YahooConverter().convert([p])[0]["options"];

/** 商品オプション(options)=自由文形式 name#v1,v2|name2#... の生成・サニタイズ。 */
describe("YahooConverter — 商品オプション(options)", () => {
  it("name#v1,v2 形式で生成", () => {
    expect(opt(makeProduct({ customization_options: [{ name: "のし", values: ["あり", "なし"] }] }))).toBe(
      "のし#あり,なし",
    );
  });
  it("複数オプションは | 区切り", () => {
    expect(
      opt(
        makeProduct({
          customization_options: [
            { name: "サイズ", values: ["S", "M"] },
            { name: "カラー", values: ["赤", "青"] },
          ],
        }),
      ),
    ).toBe("サイズ#S,M|カラー#赤,青");
  });
  it("使用不可文字(# : | , 半角スペース)を name/value から除去", () => {
    expect(
      opt(makeProduct({ customization_options: [{ name: "色 :A#", values: ["赤,い", "青|い"] }] })),
    ).toBe("色A#赤い,青い");
  });
  it("オプション無し → 空文字", () => {
    expect(opt(makeProduct({}))).toBe("");
  });
});
