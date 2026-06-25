import { describe, it, expect } from "vitest";
import { parseNeSyohin, parseNeSet, parseHimoduke, parseExcelMaster, parseExcelMall } from "./parse";

describe("parse", () => {
  it("NE商品マスタ(クォート)", () => {
    const rows = parseNeSyohin('"syohin_code","syohin_name","baika_tnk","tax_rate","zaiko_su"\n"a008-4032-1","青切り","2191","8","99831"\n');
    expect(rows).toEqual([{ ne_code: "a008-4032-1", name: "青切り", selling_price: 2191, tax_rate: 8 }]);
  });

  it("NEセット(RFCクォート・説明文が複数行に跨る・先頭8列をindex取得・残骸行skip)", () => {
    const header = "set_syohin_code,daihyo_syohin_code,set_syohin_name,set_baika_tnk,tax_rate,syohin_code,suryo,jan_code,setumei1\n";
    const rec = 'a008-4032-3,,青切りシークヮーサー500ml,6286,8,a008-4032-1,3,4582218324032,"説明文1行目,カンマ入り\n2行目\n3行目"\n';
    const rows = parseNeSet(header + rec);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ set_ne_code: "a008-4032-3", component_ne_code: "a008-4032-1", suryo: 3, set_price: 6286, tax_rate: 8 });
  });

  it("NEセット: コード書式外/数量非整数の残骸行はskip", () => {
    const header = "set_syohin_code,daihyo,name,price,tax,syohin_code,suryo,jan\n";
    const ok = "a-3,,名,100,8,a-1,2,\n";
    const junk = "説明の続き,,,,,,,\n"; // 継続行のような残骸
    expect(parseNeSet(header + ok + junk)).toHaveLength(1);
  });

  it("himoduke(在庫連携・代表)", () => {
    const rows = parseHimoduke("商品コード,代表商品コード,取込元,商品名,在庫連携,楽天\nr7201-3-hr3,r7201-3,,名,する,\n");
    expect(rows[0]).toEqual({ ne_code: "r7201-3-hr3", daihyo_code: "r7201-3", zaiko_renkei: "する" });
  });

  it("Excel商品マスタ(備品=NEコード空 は除外)", () => {
    const csv = "仕入先,JANコード,NEコード,仕入先CD,商品名,仕入れ価格,税率,カテゴリ,備品フラグ\nA,4955028002542,t002-2542-1,,名,1000,10,酒,\nB,RET PR,,,,備品,10,備品,〇\n";
    const rows = parseExcelMaster(csv);
    expect(rows).toEqual([{ ne_code: "t002-2542-1", jan_code: "4955028002542", name: "名", cost_price: 1000, tax_rate: 10, category: "酒", supplier: "A" }]);
  });

  it("Excel楽天(商品番号=ne_code)", () => {
    const csv = "商品管理番号,商品番号,項目名,選択肢,JANコード,商品名,数量\naogiri-sh2,a008-4032-3,,,4582218324032,青切り,3\n";
    const rows = parseExcelMall(csv, "rakuten");
    expect(rows[0]).toMatchObject({ manage_no: "aogiri-sh2", ne_code: "a008-4032-3", jan_code: "4582218324032", suryo: 3 });
  });

  it("Excel Yahoo(ne_code列なし→空)", () => {
    const csv = "商品管理番号,項目名,選択肢,JANコード,商品名,数量\n4582469501015,■1本目,フローラル,4582469501015,柔軟剤,1\n";
    const rows = parseExcelMall(csv, "yahoo");
    expect(rows[0]).toMatchObject({ manage_no: "4582469501015", ne_code: "", jan_code: "4582469501015", suryo: 1 });
  });
});
