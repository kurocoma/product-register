/** 楽天の公開商品ページURL生成（rakutenItemPageUrl）のテスト（260720依頼: RMS/商品ページリンク）。 */
import { describe, expect, it } from "vitest";

import { RAKUTEN_RMS_URL, rakutenItemPageUrl } from "./store";

describe("rakutenItemPageUrl", () => {
  it("店舗IDと管理番号から公開商品ページURLを組み立てる", () => {
    expect(rakutenItemPageUrl("ichiban-okinawa", "t002-2542")).toBe(
      "https://item.rakuten.co.jp/ichiban-okinawa/t002-2542/",
    );
  });

  it("管理番号が未設定・空白なら null（リンクを出さない）", () => {
    expect(rakutenItemPageUrl("ichiban-okinawa", "")).toBeNull();
    expect(rakutenItemPageUrl("ichiban-okinawa", "  ")).toBeNull();
    expect(rakutenItemPageUrl("ichiban-okinawa", undefined)).toBeNull();
    expect(rakutenItemPageUrl("ichiban-okinawa", null)).toBeNull();
  });

  it("前後の空白は除去して使う", () => {
    expect(rakutenItemPageUrl("ichiban-okinawa", " r74-1 ")).toBe(
      "https://item.rakuten.co.jp/ichiban-okinawa/r74-1/",
    );
  });
});

describe("RAKUTEN_RMS_URL", () => {
  it("RMS メインメニューを指す", () => {
    expect(RAKUTEN_RMS_URL).toBe("https://mainmenu.rms.rakuten.co.jp/");
  });
});
