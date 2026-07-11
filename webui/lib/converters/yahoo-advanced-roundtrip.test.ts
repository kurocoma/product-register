import { describe, it, expect } from "vitest";
import { xmlToEditItemParams } from "./yahoo-patch";

// 260712修正依頼-3: ストア側に spec / grouping / variation 設定がある商品（例: n019-0298-1）の
// 反映が「API更新で保持できない設定を含むため中止」でブロックされる。
// editItem は spec1-10 / grouping_id / variation1-5_{spec_id,name,free_title} を送信できる
// （公式 editItem.html で確認）ため、getItem からの転記でラウンドトリップ可能にし、
// 転記できたものは advanced（反映ブロック）から外す。
const SELLER = "test-store";

const BASE_XML = (extra: string) => `<?xml version="1.0"?>
<Result>
  <ItemCode>n019-0298-1</ItemCode>
  <Name><![CDATA[紅芋タルト 3個入]]></Name>
  <Price>1000</Price>
  <ProductCategory>1234</ProductCategory>
  <PathList><Path><![CDATA[食品:菓子]]></Path></PathList>
  ${extra}
</Result>`;

describe("xmlToEditItemParams — spec/grouping/variation のラウンドトリップ", () => {
  it("SpecN(SpecId+SpecValue) を specN='id:value' へ転記し、advanced から spec を外す", () => {
    const xml = BASE_XML(
      `<Spec1><SpecId>3</SpecId><SpecName>容量</SpecName><SpecValue>1041</SpecValue><SpecValueName>500g</SpecValueName></Spec1>
       <Spec2><SpecId>7</SpecId><SpecValue>88</SpecValue></Spec2>`,
    );
    const { params, advanced } = xmlToEditItemParams(xml, SELLER);
    expect(params.spec1).toBe("3:1041");
    expect(params.spec2).toBe("7:88");
    expect(advanced).not.toContain("spec");
  });

  it("VariationN(SpecID/Name/FreeTitle) を variationN_* へ転記し、advanced から variation を外す", () => {
    const xml = BASE_XML(
      `<Variation1><SpecID>100</SpecID><Name>内容量</Name></Variation1>
       <Variation2><SpecID>200</SpecID><Name>タイプ</Name><FreeTitle>味の種類</FreeTitle></Variation2>`,
    );
    const { params, advanced } = xmlToEditItemParams(xml, SELLER);
    expect(params.variation1_spec_id).toBe("100");
    expect(params.variation1_name).toBe("内容量");
    expect(params.variation2_free_title).toBe("味の種類");
    expect(advanced).not.toContain("variation");
  });

  it("Variation の Name は商品名(name)を汚染しない（コンテナ内スコープで抽出）", () => {
    const xml = BASE_XML(`<Variation1><SpecID>100</SpecID><Name>内容量</Name></Variation1>`);
    const { params } = xmlToEditItemParams(xml, SELLER);
    expect(params.name).toBe("紅芋タルト 3個入");
    expect(params.variation1_name).toBe("内容量");
  });

  it("GroupingId を grouping_id へ転記し、advanced から grouping を外す", () => {
    const xml = BASE_XML(`<GroupingId>grp-0298</GroupingId>`);
    const { params, advanced } = xmlToEditItemParams(xml, SELLER);
    expect(params.grouping_id).toBe("grp-0298");
    expect(advanced).not.toContain("grouping");
  });

  it("spec+grouping+variation を全部含む商品（実機エラーの再現形）で advanced が空になる", () => {
    const xml = BASE_XML(
      `<Spec1><SpecId>3</SpecId><SpecValue>1041</SpecValue></Spec1>
       <GroupingId>grp-0298</GroupingId>
       <Variation1><SpecID>100</SpecID><Name>内容量</Name></Variation1>`,
    );
    const { advanced } = xmlToEditItemParams(xml, SELLER);
    expect(advanced).toEqual([]);
  });

  it("転記できない形の Spec（SpecId 無し）は安全側で advanced に spec を残す", () => {
    const xml = BASE_XML(`<Spec1><SpecValueName>不明な形</SpecValueName></Spec1>`);
    const { params, advanced } = xmlToEditItemParams(xml, SELLER);
    expect(params.spec1).toBeUndefined();
    expect(advanced).toContain("spec");
  });

  it("options / subcodes は引き続き advanced（反映ブロック）のまま", () => {
    const xml = BASE_XML(
      `<Options><Option type="option" name="サイズ"><Value name="S"/><Value name="M"/></Option></Options>
       <SubCodes><SubCode code="sub-1"><Option name="サイズ" value="S"/></SubCode></SubCodes>`,
    );
    const { advanced } = xmlToEditItemParams(xml, SELLER);
    expect(advanced).toContain("options");
    expect(advanced).toContain("subcodes");
  });
});
