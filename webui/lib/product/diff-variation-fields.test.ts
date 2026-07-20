/** バリエーション軸（variation_key / variation_name）の差分検出（260720実件:
 * 「タイプ表示を変えたのに反映で変わらない」を可視化する）。
 * - diffProduct: 変更を検出する（snapshot にキーが無ければ比較しない＝他モール誤検知なし）
 * - 楽天 patch: 送信対象にはならず skipped に載る（変更は「登録(upsert)」経由で送る） */
import { describe, expect, it } from "vitest";

import { makeProduct } from "./schema";
import { diffProduct } from "./diff";
import { buildRakutenPatchBody } from "../converters/rakuten-patch";

describe("diffProduct — バリエーション軸の検出", () => {
  it("variation_name の変更を検出する", () => {
    const snapshot = makeProduct({ variation_name: "タイプ" });
    const edited = makeProduct({ variation_name: "袋数" });
    const changed = diffProduct(snapshot, edited);
    expect(changed.map((c) => c.field)).toContain("variation_name");
  });

  it("snapshot にキーが無ければ比較しない（他モール経路の誤検知防止）", () => {
    const edited = makeProduct({ variation_name: "袋数" });
    const changed = diffProduct({}, edited);
    expect(changed.map((c) => c.field)).not.toContain("variation_name");
  });
});

describe("buildRakutenPatchBody — バリエーション軸は skipped", () => {
  it("variation_name / variation_key は patch で送らず skipped に載せる", () => {
    const p = makeProduct({ variation_name: "袋数", variation_key: "select1" });
    const { body, skipped } = buildRakutenPatchBody(
      [
        { field: "variation_name", before: "タイプ", after: "袋数" },
        { field: "variation_key", before: "type", after: "select1" },
      ],
      p,
    );
    expect(skipped).toContain("variation_name");
    expect(skipped).toContain("variation_key");
    expect(body.variantSelectors).toBeUndefined();
  });
});
