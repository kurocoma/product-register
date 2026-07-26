import { describe, it, expect, vi, afterEach } from "vitest";
import { reservePublish } from "./item-client";

// reservePublish の mode 対応（1=予約 / 2=キャンセル / 3=予約確認）。docs/Yahoo/06 §1。
// 既定は 1 のまま（既存呼び出しの互換）。

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const res = (body: string, status = 200) => ({ status, text: async () => body }) as unknown as Response;

describe("reservePublish", () => {
  it("既定は mode=1（全反映予約）で送る", async () => {
    const spy = vi.fn(async () => res(`<ResultSet><Status>OK</Status><ReserveTime>2026-07-27T10:00:00+09:00</ReserveTime></ResultSet>`));
    global.fetch = spy as unknown as typeof fetch;
    const r = await reservePublish("tok", "seller");
    expect(r.ok).toBe(true);
    expect(r.reserveTime).toBe("2026-07-27T10:00:00+09:00");
    expect(String((spy.mock.calls[0][1] as RequestInit).body)).toContain("mode=1");
  });

  it("mode=3（予約確認）を指定できる", async () => {
    const spy = vi.fn(async () => res(`<ResultSet><Status>OK</Status></ResultSet>`));
    global.fetch = spy as unknown as typeof fetch;
    await reservePublish("tok", "seller", 3);
    expect(String((spy.mock.calls[0][1] as RequestInit).body)).toContain("mode=3");
  });

  it("pm-05001（未反映なし）は成功扱い", async () => {
    global.fetch = vi.fn(async () => res(`<ResultSet><Error><Code>pm-05001</Code><Message>未反映の項目がありません</Message></Error></ResultSet>`, 400)) as unknown as typeof fetch;
    const r = await reservePublish("tok", "seller");
    expect(r.ok).toBe(true);
    expect(r.message).toContain("反映済み");
  });

  it("その他のエラーは ok:false", async () => {
    global.fetch = vi.fn(async () => res(`<ResultSet><Error><Code>pm-05002</Code><Message>反映処理中のため予約不可</Message></Error></ResultSet>`, 400)) as unknown as typeof fetch;
    const r = await reservePublish("tok", "seller");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("pm-05002");
  });
});
