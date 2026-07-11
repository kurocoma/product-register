import { describe, it, expect } from "vitest";
import { MAX_IMAGE_SLOTS, planUploadIndices } from "./upload-plan";

describe("planUploadIndices（一括アップロードの番号割当）", () => {
  it("開始1で3枚 → [1, 2, 3]", () => {
    expect(planUploadIndices(3, 1, { indexed: true })).toEqual({ indices: [1, 2, 3], overflow: 0 });
  });

  it("開始5で3枚 → [5, 6, 7]", () => {
    expect(planUploadIndices(3, 5, { indexed: true })).toEqual({ indices: [5, 6, 7], overflow: 0 });
  });

  it("indexed=false（楽天wb）は全て null で番号を割り当てない", () => {
    expect(planUploadIndices(3, 5, { indexed: false })).toEqual({
      indices: [null, null, null],
      overflow: 0,
    });
  });

  it("開始19で3枚 → indices は 20 以内の [19, 20] のみで overflow 1", () => {
    expect(planUploadIndices(3, 19, { indexed: true })).toEqual({
      indices: [19, 20],
      overflow: 1,
    });
  });

  it("開始20で1枚はちょうど上限(20)に収まる", () => {
    expect(planUploadIndices(1, MAX_IMAGE_SLOTS, { indexed: true })).toEqual({
      indices: [20],
      overflow: 0,
    });
  });

  it("開始21は全て範囲外（indices 空・overflow のみ）", () => {
    expect(planUploadIndices(2, 21, { indexed: true })).toEqual({ indices: [], overflow: 2 });
  });

  it("0枚は空（indexed の真偽によらず）", () => {
    expect(planUploadIndices(0, 1, { indexed: true })).toEqual({ indices: [], overflow: 0 });
    expect(planUploadIndices(0, 1, { indexed: false })).toEqual({ indices: [], overflow: 0 });
  });
});
