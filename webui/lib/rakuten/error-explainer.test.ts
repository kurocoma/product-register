import { describe, expect, it } from "vitest";
import { explainRakutenError, translateRakutenFieldPath } from "./error-explainer";

describe("explainRakutenError", () => {
  it("IE0004/IE0177（260723実件の生メッセージ）を日本語の原因・対処に変換する", () => {
    const raw =
      "IE0004: Max length of variants.1177.specs[1].value must be within 140 bytes. / " +
      "IE0004: Max length of variants.1176.specs[1].value must be within 140 bytes. / " +
      "IE0177: variants.1176.specs[1].value cannot include new line. / " +
      "IE0177: variants.1177.specs[1].value cannot include new line.";
    const out = explainRakutenError(raw);

    expect(out).toContain("【原因の説明】");
    expect(out).toContain("IE0004");
    expect(out).toContain("140バイト＝全角約46文字");
    expect(out).toContain("IE0177");
    expect(out).toContain("改行");
    // フィールドパスの和訳（specs[1] は2行目）
    expect(out).toContain("SKU 1177 の自由入力行2の値");
    expect(out).toContain("SKU 1176 の自由入力行2の値");
    // 同一コードの重複説明はしない
    expect(out.match(/IE0004:/g)).toHaveLength(1);
    expect(out.match(/IE0177:/g)).toHaveLength(1);
  });

  it("IE0418（ジャンル必須属性不足）は旧hintと同じ対処を案内する", () => {
    const out = explainRakutenError("IE0418: mandatory attribute is missing.");
    expect(out).toContain("ジャンル必須属性");
    expect(out).toContain("カテゴリIDから属性を読み込み");
  });

  it("GE0011（空リクエスト）も説明する", () => {
    const out = explainRakutenError("GE0011: Request body is missing or is empty without any attributes.");
    expect(out).toContain("GE0011");
    expect(out).toContain("空のリクエスト");
  });

  it("未知コードだけ・コード無しのメッセージには何も付けない", () => {
    expect(explainRakutenError("IE9999: unknown mystery error.")).toBe("");
    expect(explainRakutenError("network timeout")).toBe("");
  });
});

describe("translateRakutenFieldPath", () => {
  it("specs のパスをSKU・行番号・項目/値に直す", () => {
    expect(translateRakutenFieldPath("variants.1177.specs[0].label")).toBe(
      "SKU 1177 の自由入力行1の項目名",
    );
    expect(translateRakutenFieldPath("variants.r0101-1.specs[4].value")).toBe(
      "SKU r0101-1 の自由入力行5の値",
    );
  });

  it("画像altのパスを和訳する", () => {
    expect(translateRakutenFieldPath("variants.1177.images[2].alt")).toBe(
      "SKU 1177 の画像3の代替テキスト(alt)",
    );
  });
});
