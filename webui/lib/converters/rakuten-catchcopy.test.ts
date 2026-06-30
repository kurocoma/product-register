import { describe, it, expect } from "vitest";
import { parseRakutenItem } from "./rakuten-item-parser";

/** 楽天キャッチコピー(tagline)を Yahoo headline 用 catch_copy_yahoo にも反映する。 */
describe("parseRakutenItem — キャッチコピー(tagline)反映", () => {
  it("tagline → catch_copy_pc と catch_copy_yahoo の両方に入る", () => {
    const p = parseRakutenItem({ title: "X", tagline: "沖縄発酵の力" });
    expect(p.catch_copy_pc).toBe("沖縄発酵の力");
    expect(p.catch_copy_yahoo).toBe("沖縄発酵の力");
  });
  it("tagline 無し → 設定しない（既定空のまま）", () => {
    const p = parseRakutenItem({ title: "X" });
    expect(p.catch_copy_yahoo).toBeUndefined();
  });
});
