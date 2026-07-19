/** upsert の商品画像 images[] 組み立てのテスト（r2201-1 実件の回帰）。
 * 背景: 取込商品は実URL（thum01/thum03 等）を image_url_N に保持するが、
 * upsert が命名規約から机上のパスを算出して送るため、実在しない thum02 パスで
 * RMS の画像参照が上書きされリンク切れになった（実測: 規約パス404・実URL200）。
 * 対策: upsert は保存済み実URLを最優先し、変換不能な index のみ規約で補完する。
 * rcabinet-sync（実アップロード済み前提）の buildImageLocations は規約算出のまま維持。 */
import { describe, it, expect } from "vitest";
import { makeProduct } from "../product/schema";
import { buildRakutenUpsertBody, buildImageLocations, buildUpsertImages } from "./rakuten-api";

const THUM01 = "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum01/r2201-1.jpg";
const THUM03 = "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum03/r2201-1_3.jpg";

describe("buildUpsertImages（upsert 用・実URL優先）", () => {
  it("保存済みの実URLをそのまま location に使う（取込商品の往復対称）", () => {
    const p = makeProduct({ image_count: 2, image_url_1: THUM01, image_url_2: THUM03 });
    expect(buildUpsertImages(p)).toEqual([
      { type: "CABINET", location: "/thum01/r2201-1.jpg" },
      { type: "CABINET", location: "/thum03/r2201-1_3.jpg" },
    ]);
  });

  it("変換できないURL（外部URL等）の index だけ規約パスで補完する", () => {
    const p = makeProduct({
      image_count: 2,
      image_url_1: "https://example.com/a.jpg",
      image_url_2: THUM03,
    });
    const out = buildUpsertImages(p);
    expect(out[0].location).toBe("/thum02/t002-2542-1.jpg"); // 規約フォールバック
    expect(out[1].location).toBe("/thum03/r2201-1_3.jpg");   // 実URL維持
  });

  it("実URLが未保存なら従来どおり全て規約パス（アプリ内新規商品の互換）", () => {
    const p = makeProduct({ image_count: 2 });
    expect(buildUpsertImages(p).map((x) => x.location)).toEqual([
      "/thum02/t002-2542-1.jpg",
      "/thum02/t002-2542_2.jpg",
    ]);
  });

  it("buildRakutenUpsertBody の images はこの実URL優先ロジックを使う", () => {
    const p = makeProduct({ image_count: 1, image_url_1: THUM01 });
    const body = buildRakutenUpsertBody(p);
    expect(body.images).toEqual([{ type: "CABINET", location: "/thum01/r2201-1.jpg" }]);
  });
});

describe("buildImageLocations（rcabinet-sync 用・規約算出のまま）", () => {
  it("実URLが保存されていても規約パスを返す（アップロード済み前提の契約を維持）", () => {
    const p = makeProduct({ image_count: 2, image_url_1: THUM01, image_url_2: THUM03 });
    expect(buildImageLocations(p).map((x) => x.location)).toEqual([
      "/thum02/t002-2542-1.jpg",
      "/thum02/t002-2542_2.jpg",
    ]);
  });
});
