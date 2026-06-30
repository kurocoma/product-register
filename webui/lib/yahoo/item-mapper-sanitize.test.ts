import { describe, it, expect } from "vitest";
import { makeProduct } from "@/lib/product/schema";
import { stripHtml, fullWidthLen } from "@/lib/product/text-fit";
import { buildYahooEditItemParams } from "./item-mapper";

const opts = { sellerId: "S" };
const angleBalanced = (s: string) =>
  (s.match(/</g) || []).length === (s.match(/>/g) || []).length;

// caption と sp-additional は YahooConverter で buildCaption(description_pc) から生成される。
// image_count<=1 のとき imgList HTML は空になり、caption=description_pc（書式保持サニタイズ対象）になる。

describe("buildYahooEditItemParams - caption sanitize (AC-S6)", () => {
  it("未閉じタグ＋<script>混入 → script無し・全タグ閉じ・全角5000内 (it-00002)", () => {
    const p = makeProduct({
      image_count: 1,
      description_pc: "<p>商品<b>説明<script>alert(1)</script>",
    });
    const params = buildYahooEditItemParams(p, opts);
    expect(params.caption).not.toContain("script");
    expect(params.caption).not.toContain("alert");
    expect(params.caption).toContain("</b>");
    expect(params.caption).toContain("</p>");
    expect(angleBalanced(params.caption)).toBe(true);
    expect(fullWidthLen(stripHtml(params.caption))).toBeLessThanOrEqual(5000);
  });

  it("sp_additional も caption と同様にサニタイズされる (it-00004)", () => {
    const p = makeProduct({
      image_count: 1,
      description_pc: "<div>説明<i>強調<script>evil()</script>",
    });
    const params = buildYahooEditItemParams(p, opts);
    expect(params.sp_additional).not.toContain("script");
    expect(params.sp_additional).not.toContain("evil");
    expect(params.sp_additional).toContain("</i>");
    expect(params.sp_additional).toContain("</div>");
    expect(angleBalanced(params.sp_additional)).toBe(true);
    expect(fullWidthLen(stripHtml(params.sp_additional))).toBeLessThanOrEqual(5000);
  });

  it("長い HTML caption はタグ境界で全角5000内に切詰され全タグ閉じ", () => {
    const p = makeProduct({
      image_count: 1,
      description_pc: "<p>" + "あ".repeat(6000) + "</p>",
    });
    const params = buildYahooEditItemParams(p, opts);
    expect(fullWidthLen(stripHtml(params.caption))).toBeLessThanOrEqual(5000);
    expect(params.caption).toContain("</p>");
    expect(angleBalanced(params.caption)).toBe(true);
    expect(fullWidthLen(stripHtml(params.sp_additional))).toBeLessThanOrEqual(5000);
  });

  it("HTML 無しの短い caption は実質不変", () => {
    const p = makeProduct({ image_count: 1, description_pc: "商品説明テキスト" });
    const params = buildYahooEditItemParams(p, opts);
    expect(params.caption).toBe("商品説明テキスト");
  });
});

describe("buildYahooEditItemParams - explanation は従来どおり HTML 全除去（不変）", () => {
  it("explanation に '<' '>' を含まない", () => {
    const p = makeProduct({
      image_count: 1,
      free1: "<p>説明<b>強</b></p>",
    });
    const params = buildYahooEditItemParams(p, opts);
    expect(params.explanation).not.toContain("<");
    expect(params.explanation).not.toContain(">");
  });
});
