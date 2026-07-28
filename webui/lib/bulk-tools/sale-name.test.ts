import { describe, expect, it } from "vitest";
import {
  addSalePrefix,
  checkSaleNameLimits,
  describeSaleNameViolation,
  RAKUTEN_TITLE_MAX_BYTES,
  rakutenTitleBytes,
  removeSalePrefix,
  validateSalePhrase,
} from "./sale-name";

describe("rakutenTitleBytes — 楽天バイト数（全角2/半角1。IE0004 実測基準）", () => {
  it("全角=2バイト・半角=1バイト・半角カナ=1バイトで数える", () => {
    expect(rakutenTitleBytes("あ")).toBe(2);
    expect(rakutenTitleBytes("a")).toBe(1);
    expect(rakutenTitleBytes("ｱ")).toBe(1); // 半角カナ
    expect(rakutenTitleBytes("あa")).toBe(3);
    expect(rakutenTitleBytes("")).toBe(0);
  });

  it("境界: 全角127字=254バイト（適合）/ 全角128字=256バイト（超過）", () => {
    expect(rakutenTitleBytes("あ".repeat(127))).toBe(254);
    expect(rakutenTitleBytes("あ".repeat(127))).toBeLessThanOrEqual(RAKUTEN_TITLE_MAX_BYTES);
    expect(rakutenTitleBytes("あ".repeat(128))).toBe(256);
    expect(rakutenTitleBytes("あ".repeat(128))).toBeGreaterThan(RAKUTEN_TITLE_MAX_BYTES);
  });

  it("境界: 半角255字=255バイト（適合）/ 半角256字=256バイト（超過）", () => {
    expect(checkSaleNameLimits("a".repeat(255)).rakutenOverBytes).toBe(0);
    expect(checkSaleNameLimits("a".repeat(256)).rakutenOverBytes).toBe(1);
  });
});

describe("checkSaleNameLimits — Yahoo 75字境界（fitYahooFieldLimits の定数と同基準）", () => {
  it("全角75字ちょうどは適合", () => {
    const c = checkSaleNameLimits("あ".repeat(75));
    expect(c.ok).toBe(true);
    expect(c.yahooFullWidth).toBe(75);
    expect(c.yahooOverFullWidth).toBe(0);
    expect(c.yahooOverChars).toBe(0);
  });

  it("全角76字は 1 字超過で違反", () => {
    const c = checkSaleNameLimits("あ".repeat(76));
    expect(c.ok).toBe(false);
    expect(c.yahooOverFullWidth).toBe(1);
    expect(describeSaleNameViolation(c)).toContain("76");
    expect(describeSaleNameViolation(c)).toContain("1字超過");
  });

  it("半角混在: 全角換算は適合でも文字数（コードポイント）超過で違反する", () => {
    // 半角150字 = 全角換算75（適合）だが文字数150 > 75（Yahoo は maxChars でも切るため違反）
    const c = checkSaleNameLimits("a".repeat(150));
    expect(c.yahooOverFullWidth).toBe(0);
    expect(c.yahooOverChars).toBe(75);
    expect(c.ok).toBe(false);
  });

  it("楽天境界: 全角128字は楽天バイト超過も報告する", () => {
    const c = checkSaleNameLimits("あ".repeat(128));
    expect(c.rakutenOverBytes).toBe(1);
    expect(describeSaleNameViolation(c)).toContain("楽天");
  });
});

describe("validateSalePhrase", () => {
  it("前後空白は除去して受理する", () => {
    expect(validateSalePhrase("  【SALE】 ")).toEqual({ ok: true, phrase: "【SALE】" });
  });
  it("空・改行入りは拒否する", () => {
    expect(validateSalePhrase("").ok).toBe(false);
    expect(validateSalePhrase("  ").ok).toBe(false);
    expect(validateSalePhrase("A\nB").ok).toBe(false);
  });
});

describe("addSalePrefix / removeSalePrefix — 追記と解除の往復", () => {
  const phrase = "【スーパーセール10%OFF】";
  const name = "沖縄そば 5食セット";

  it("追記: 文言＋半角スペース1個＋元名", () => {
    const r = addSalePrefix(name, phrase);
    expect(r).toEqual({ ok: true, after: `${phrase} ${name}` });
  });

  it("追記→解除で元の商品名に戻る", () => {
    const added = addSalePrefix(name, phrase);
    if (!added.ok) throw new Error("unreachable");
    const removed = removeSalePrefix(added.after, phrase);
    expect(removed).toEqual({ ok: true, after: name });
  });

  it("追記は冪等ガード: 既に追記済みならスキップ", () => {
    const added = addSalePrefix(name, phrase);
    if (!added.ok) throw new Error("unreachable");
    expect(addSalePrefix(added.after, phrase).ok).toBe(false);
  });

  it("解除: 先頭に文言が無い商品はスキップ（理由つき）", () => {
    const r = removeSalePrefix(name, phrase);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("先頭にセール文言がありません");
  });

  it("解除: 文言だけの商品名・除去後に空になる場合はスキップ", () => {
    expect(removeSalePrefix(phrase, phrase).ok).toBe(false);
    expect(removeSalePrefix(`${phrase}  `, phrase).ok).toBe(false);
  });

  it("解除は完全一致（文言の部分一致では外れない）", () => {
    expect(removeSalePrefix(`${phrase}${name}`, phrase).ok).toBe(false); // スペース無し=追記形式でない
  });
});
