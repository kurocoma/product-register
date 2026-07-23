import { describe, it, expect } from "vitest";
// 機密ワークスペースの純関数モジュール（副作用なし）を読み込む。allowJs により型は any。
import { cutNutritionValue } from "../../.codex-work/shimanoya-app-update/nutrition-cut.mjs";

// 実データ（監査 inspect の 栄養成分 要確認 行）に基づくサンプル。
const R117 = [
  "2粒(0.6g)あたり",
  "エネルギー\t2.3kcal",
  "たんぱく質\t0.02g",
  "脂質\t0.01g",
  "炭水化物\t0.53g",
  "食塩相当量\t0.001g",
  "銅\t1.8mg(200%)※",
  "",
  "※栄養素等表示基準値(18歳以上、基準熱量2200kcal)に占める割合",
  "",
  "【栄養機能食品（銅）】",
  "銅は、赤血球の形成を助ける栄養素です。銅は、多くの体内酵素の正常な働きと骨の形成を助ける栄養素です。",
  "",
  "本品は、多量摂取により疾病が治癒したり、より健康が増進するものではありません。一日の摂取目安量を守ってください。",
  "本品は、特定保健用食品と異なり、消費者庁長官による個別審査を受けたものではありません。",
].join("\n");

const R8401 = [
  "2球(0.66g)あたり",
  "エネルギー\t4.01kcal",
  "たんぱく質\t0.19g",
  "脂質\t0.30g",
  "炭水化物\t0.14g",
  "食塩相当量\t0.00005g",
  "ビタミンA\t393.4μｇ(51%)※",
  "ビタミンE\t6.18mg(98%※)※",
  "",
  "※栄養素等表示基準値(18歳以上、基準熱量2200kcal)に占める割合",
  "",
  "【栄養機能食品（ビタミンA・ビタミンE）】",
  "ビタミンAは、夜間の視力の維持を助けるとともに、皮膚や粘膜の健康維持を助ける栄養素です。",
  "本品は、特定保健用食品と異なり、消費者庁長官による個別審査を受けたものではありません。",
].join("\n");

const R7201 = [
  "複数商品で値が異なるため専用値が必要",
  "1本(10g)あたり",
  "エネルギー\t7.3kcal",
  "たんぱく質\t1.09g",
  "---",
  "1本(10g)あたり",
  "エネルギー\t8.6kcal",
  "たんぱく質\t1.08g",
].join("\n");

describe("cutNutritionValue（栄養成分カット規則・しまのや第2ステージ）", () => {
  it("境界『※栄養素等表示基準値』以降を落とし、成分リストと成分行内の※印を残して採用する", () => {
    const r = cutNutritionValue(R117);
    expect(r.boundaryFound).toBe(true);
    expect(r.adopted).toBe(true);
    expect(r.cutLength).toBeLessThanOrEqual(255);
    expect(r.cutLength).toBeLessThan(r.originalLength);
    expect(r.cut).toContain("2粒(0.6g)あたり");
    expect(r.cut.endsWith("銅\t1.8mg(200%)※")).toBe(true); // 成分行末尾の※は残す
    expect(r.cut).not.toContain("※栄養素等表示基準値");
    expect(r.cut).not.toContain("【栄養機能食品");
    expect(r.cut).not.toContain("本品は、");
  });

  it("成分行内に複数の※・全角文字があっても成分リストを保持して採用する", () => {
    const r = cutNutritionValue(R8401);
    expect(r.adopted).toBe(true);
    expect(r.cut).toContain("ビタミンE\t6.18mg(98%※)※");
    expect(r.cut).not.toContain("【栄養機能食品");
    expect(r.cut).not.toContain("夜間の視力");
  });

  it("境界が無く『複数商品/---』の曖昧値は自動採用せず保留にする", () => {
    const r = cutNutritionValue(R7201);
    expect(r.boundaryFound).toBe(false);
    expect(r.adopted).toBe(false);
    expect(r.reason).toContain("曖昧");
  });

  it("カット後も255文字を超える場合は保留にする", () => {
    const long = ["2球(0.66g)あたり", "x".repeat(300), "※栄養素等表示基準値(...)", "説明"].join("\n");
    const r = cutNutritionValue(long);
    expect(r.boundaryFound).toBe(true);
    expect(r.cutLength).toBeGreaterThan(255);
    expect(r.adopted).toBe(false);
  });

  it("行頭に全角スペースがある境界行も検出する", () => {
    const v = ["1球あたり", "エネルギー\t1kcal", "　※栄養素等表示基準値(...)に占める割合", "【栄養機能食品】"].join("\n");
    const r = cutNutritionValue(v);
    expect(r.boundaryFound).toBe(true);
    expect(r.adopted).toBe(true);
    expect(r.cut).toBe(["1球あたり", "エネルギー\t1kcal"].join("\n"));
  });

  it("空値・空白のみは保留にする", () => {
    expect(cutNutritionValue("").adopted).toBe(false);
    expect(cutNutritionValue("   \n  ").adopted).toBe(false);
  });
});
