import { describe, it, expect } from "vitest";
import {
  DEFAULT_RAKUTEN_STORE,
  rakutenCabinetBase,
  RCABINET_FOLDER,
} from "./store";

describe("rakuten store constants", () => {
  it("デフォルト店舗名を一元管理する", () => {
    expect(DEFAULT_RAKUTEN_STORE).toBe("ichiban-okinawa");
  });

  it("店舗名とフォルダから R-Cabinet 公開URLベースを組み立てる", () => {
    expect(rakutenCabinetBase("ichiban-okinawa", "thum02")).toBe(
      "https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02",
    );
  });

  it("商品画像フォルダ(thum02)と白背景フォルダ(wb01)の FolderId を保持する", () => {
    // files/search で実機確認済みの folderId
    expect(RCABINET_FOLDER.thum02.path).toBe("thum02");
    expect(RCABINET_FOLDER.thum02.folderId).toBe(10502933);
    expect(RCABINET_FOLDER.wb01.path).toBe("wb01");
    expect(RCABINET_FOLDER.wb01.folderId).toBe(8266494);
  });
});
