import { describe, expect, it } from "vitest";
import { buildYahooUpdateParams, xmlToEditItemParams } from "./yahoo-patch";
import { makeProduct } from "@/lib/product/schema";

/** 商品オプション(Options)の getItem → editItem 転記（260723・オプションガード51商品の実件）。
 * XML形状は okimarumarket 実商品（r0101-1 / r8601-1）の getItem 実測値に基づく。 */

const wrap = (options: string) => `<Result><ItemCode>test-1</ItemCode>${options}</Result>`;

const SIMPLE = `<Options>
      <Option type="2" name="レビューを書いて特典GET！" specId="">
        <Value unselectableFlag="0" option_charge="" specValue="" name="特典をお選びください。"/>
        <Value unselectableFlag="0" option_charge="" specValue="" name="サプリケース"/>
        <Value unselectableFlag="0" option_charge="" specValue="" name="琉球青汁"/>
      </Option>
    </Options>`;

const DOUBLE = `<Options>
      <Option type="2" name="お届け方法" specId="">
        <Value unselectableFlag="0" option_charge="" specValue="" name="ゆうパケット（送料330円)"/>
        <Value unselectableFlag="0" option_charge="" specValue="" name="宅急便（送料550円)"/>
      </Option>
      <Option type="2" name="レビューを書いて特典GET！" specId="">
        <Value unselectableFlag="0" option_charge="" specValue="" name="特典をお選びください。"/>
        <Value unselectableFlag="0" option_charge="" specValue="" name="サプリケース"/>
      </Option>
    </Options>`;

describe("Options の editItem 転記（保持）", () => {
  it("単一オプションを name#v1,v2 形式へ転記し、advancedブロックしない", () => {
    const { params, advanced } = xmlToEditItemParams(wrap(SIMPLE), "seller");
    expect(params.options).toBe("レビューを書いて特典GET！#特典をお選びください。,サプリケース,琉球青汁");
    expect(advanced).not.toContain("options");
  });

  it("複数オプションは | 区切り（getItemの並び順を保持）", () => {
    const { params, advanced } = xmlToEditItemParams(wrap(DOUBLE), "seller");
    expect(params.options).toBe(
      "お届け方法#ゆうパケット（送料330円),宅急便（送料550円)|レビューを書いて特典GET！#特典をお選びください。,サプリケース",
    );
    expect(advanced).not.toContain("options");
  });

  it("Options が無ければ params.options を作らず、ブロックもしない", () => {
    const { params, advanced } = xmlToEditItemParams(wrap(""), "seller");
    expect(params.options).toBeUndefined();
    expect(advanced).not.toContain("options");
  });
});

describe("DBのcustomization_optionsを正とする上書き（260723裁定）", () => {
  it("DBが非空なら、Yahoo現在値ではなくDB由来のoptionsを送る（不要オプションの削除が反映される）", () => {
    const p = makeProduct({
      customization_options: [
        { name: "レビューを書いて特典GET！", values: ["特典をお選びください。", "サプリケース", "琉球青汁"] },
      ],
    });
    const { params, advanced } = buildYahooUpdateParams(wrap(DOUBLE), [], p, { sellerId: "s" });
    expect(advanced).not.toContain("options");
    // Yahoo側の「お届け方法」はDBに無いため送信値から消える
    expect(params.options).toBe("レビューを書いて特典GET！#特典をお選びください。,サプリケース,琉球青汁");
  });

  it("DBが空なら、Yahoo現在値のoptionsを維持する（暗黙の全消しをしない）", () => {
    const p = makeProduct({ customization_options: [] });
    const { params } = buildYahooUpdateParams(wrap(SIMPLE), [], p, { sellerId: "s" });
    expect(params.options).toBe("レビューを書いて特典GET！#特典をお選びください。,サプリケース,琉球青汁");
  });

  it("Yahoo側が未対応形なら、DBが非空でも上書きせずブロックを維持する", () => {
    const p = makeProduct({ customization_options: [{ name: "のし", values: ["あり", "なし"] }] });
    const exotic = SIMPLE.replace('option_charge="" specValue="" name="サプリケース"', 'option_charge="500" specValue="" name="サプリケース"');
    const { params, advanced } = buildYahooUpdateParams(wrap(exotic), [], p, { sellerId: "s" });
    expect(advanced).toContain("options");
    expect(params.options).toBeUndefined();
  });
});

describe("未対応形は転記せず従来どおり advanced ブロック（安全側）", () => {
  const cases: [string, string][] = [
    ["type が 2 以外（意味未確認）", SIMPLE.replace('type="2"', 'type="1"')],
    ["スペック連携（specId あり）", SIMPLE.replace('specId=""', 'specId="10011"')],
    ["有料オプション（option_charge あり）", SIMPLE.replace('option_charge="" specValue="" name="サプリケース"', 'option_charge="500" specValue="" name="サプリケース"')],
    ["選択不可（unselectableFlag=1）", SIMPLE.replace('unselectableFlag="0" option_charge="" specValue="" name="サプリケース"', 'unselectableFlag="1" option_charge="" specValue="" name="サプリケース"')],
    ["区切り文字がオプション名に混入", SIMPLE.replace('name="レビューを書いて特典GET！"', 'name="a#b"')],
  ];
  for (const [label, xml] of cases) {
    it(label, () => {
      const { params, advanced } = xmlToEditItemParams(wrap(xml), "seller");
      expect(params.options).toBeUndefined();
      expect(advanced).toContain("options");
    });
  }
});
