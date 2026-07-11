import { describe, it, expect } from "vitest";
import { matchesProductQuery, matchesListedFilter, type ListedFilter } from "./search";

describe("matchesProductQuery（NEコード・商品名・JANコードの部分一致）", () => {
  const p = { ne_code: "a001-1234", product_name: "沖縄そば 5食セット", jan_code: "4900000001111" };

  it("空クエリは常に true（絞り込みなし）", () => {
    expect(matchesProductQuery(p, "")).toBe(true);
    expect(matchesProductQuery(p, "   ")).toBe(true); // 空白のみも同様
  });

  it("NEコードの部分一致でヒットする", () => {
    expect(matchesProductQuery(p, "a001-12")).toBe(true);
  });

  it("商品名の部分一致でヒットする", () => {
    expect(matchesProductQuery(p, "沖縄そば")).toBe(true);
  });

  it("JANコードの部分一致でヒットする", () => {
    expect(matchesProductQuery(p, "490000000111")).toBe(true);
  });

  it("大文字小文字を無視する（クエリ・値の両方向）", () => {
    expect(matchesProductQuery(p, "A001")).toBe(true);
    expect(matchesProductQuery({ ...p, ne_code: "B002-XYZ" }, "b002-xyz")).toBe(true);
  });

  it("クエリ前後の空白は無視して照合する", () => {
    expect(matchesProductQuery(p, "  沖縄そば ")).toBe(true);
  });

  it("どのフィールドにも含まれなければ false", () => {
    expect(matchesProductQuery(p, "存在しないキーワード")).toBe(false);
    expect(matchesProductQuery(p, "9999999999999")).toBe(false);
  });

  it("jan_code 未指定の商品は JAN ではヒットしない（NEコード・商品名のみで照合）", () => {
    const noJan = { ne_code: "c003", product_name: "テスト商品" };
    expect(matchesProductQuery(noJan, "4900")).toBe(false);
    expect(matchesProductQuery(noJan, "テスト")).toBe(true);
  });
});

describe("matchesListedFilter（楽天/Yahoo 掲載状況の絞り込み）", () => {
  const all: { rakuten: ListedFilter; yahoo: ListedFilter } = { rakuten: "", yahoo: "" };
  const rakutenOnly = { rakuten: true, yahoo: false };
  const yahooOnly = { rakuten: false, yahoo: true };
  const both = { rakuten: true, yahoo: true };
  const none = { rakuten: false, yahoo: false };

  it("両方 ''（全て）は掲載状況によらず常に true", () => {
    for (const presence of [rakutenOnly, yahooOnly, both, none]) {
      expect(matchesListedFilter(presence, all)).toBe(true);
    }
  });

  it("楽天=掲載中（listed）は楽天掲載済みの商品だけ通す", () => {
    const f = { ...all, rakuten: "listed" as const };
    expect(matchesListedFilter(rakutenOnly, f)).toBe(true);
    expect(matchesListedFilter(both, f)).toBe(true);
    expect(matchesListedFilter(yahooOnly, f)).toBe(false);
    expect(matchesListedFilter(none, f)).toBe(false);
  });

  it("楽天=未掲載（unlisted）は楽天未掲載の商品だけ通す", () => {
    const f = { ...all, rakuten: "unlisted" as const };
    expect(matchesListedFilter(yahooOnly, f)).toBe(true);
    expect(matchesListedFilter(none, f)).toBe(true);
    expect(matchesListedFilter(rakutenOnly, f)).toBe(false);
    expect(matchesListedFilter(both, f)).toBe(false);
  });

  it("Yahoo=掲載中 / 未掲載 も同様に判定する", () => {
    expect(matchesListedFilter(yahooOnly, { ...all, yahoo: "listed" })).toBe(true);
    expect(matchesListedFilter(rakutenOnly, { ...all, yahoo: "listed" })).toBe(false);
    expect(matchesListedFilter(rakutenOnly, { ...all, yahoo: "unlisted" })).toBe(true);
    expect(matchesListedFilter(both, { ...all, yahoo: "unlisted" })).toBe(false);
  });

  it("楽天とYahooの両方を指定したときは AND（両方満たす商品のみ）", () => {
    const f: { rakuten: ListedFilter; yahoo: ListedFilter } = { rakuten: "listed", yahoo: "unlisted" };
    expect(matchesListedFilter(rakutenOnly, f)).toBe(true); // 楽天掲載 + Yahoo未掲載
    expect(matchesListedFilter(both, f)).toBe(false); // Yahooにも掲載済み → 外れる
    expect(matchesListedFilter(none, f)).toBe(false); // 楽天未掲載 → 外れる
  });
});
