import { describe, it, expect } from "vitest";
import { isQpsLimit, createQpsPacer } from "./qps-retry";

// 260712修正依頼: 画像再アップロードが「7枚目 QPSLimit」で失敗する。
// R-Cabinet API は秒間リクエスト制限があり、無ウェイト連続呼び出しで超過するため、
// 呼び出し間隔を空け、QPSLimit 応答時は待って再試行するヘルパを検証する。
describe("isQpsLimit — R-Cabinet の QPS 制限応答の判定", () => {
  it("QPSLimit を含むメッセージを検出する（大文字小文字不問）", () => {
    expect(isQpsLimit("QPSLimit")).toBe(true);
    expect(isQpsLimit("システムエラー: qpslimit を超過")).toBe(true);
  });
  it("QPS と無関係なエラーや undefined は検出しない", () => {
    expect(isQpsLimit("AuthError")).toBe(false);
    expect(isQpsLimit(undefined)).toBe(false);
  });
});

describe("createQpsPacer — 呼び出し間隔とリトライ", () => {
  const fakeSleep = () => {
    const waits: number[] = [];
    return { waits, sleep: (ms: number) => { waits.push(ms); return Promise.resolve(); } };
  };

  it("1回目は待たず、2回目以降は intervalMs 待ってから呼ぶ", async () => {
    const { waits, sleep } = fakeSleep();
    const pace = createQpsPacer({ intervalMs: 1100, sleep });
    const ok = { ok: true };
    await pace(() => Promise.resolve(ok), () => false);
    await pace(() => Promise.resolve(ok), () => false);
    await pace(() => Promise.resolve(ok), () => false);
    expect(waits).toEqual([1100, 1100]);
  });

  it("QPSLimit 応答なら待って再試行し、回復したら成功結果を返す", async () => {
    const { waits, sleep } = fakeSleep();
    const pace = createQpsPacer({ intervalMs: 1000, retries: 3, sleep });
    let calls = 0;
    const result = await pace(
      () => Promise.resolve(++calls <= 2 ? { ok: false, message: "QPSLimit" } : { ok: true, message: "" }),
      (r) => !r.ok && isQpsLimit(r.message),
    );
    expect(calls).toBe(3);
    expect(result.ok).toBe(true);
    expect(waits.length).toBe(2); // 再試行前に2回待つ（初回呼び出し前は待たない）
    expect(waits.every((w) => w >= 1000)).toBe(true);
  });

  it("retries 回まで再試行しても回復しなければ最後の失敗結果を返す", async () => {
    const { sleep } = fakeSleep();
    const pace = createQpsPacer({ intervalMs: 1000, retries: 3, sleep });
    let calls = 0;
    const result = await pace(
      () => { calls++; return Promise.resolve({ ok: false, message: "QPSLimit" }); },
      (r) => !r.ok && isQpsLimit(r.message),
    );
    expect(calls).toBe(4); // 初回 + リトライ3回
    expect(result.ok).toBe(false);
  });

  it("QPSLimit 以外の失敗は再試行しない（従来どおり即失敗）", async () => {
    const { sleep } = fakeSleep();
    const pace = createQpsPacer({ intervalMs: 1000, retries: 3, sleep });
    let calls = 0;
    const result = await pace(
      () => { calls++; return Promise.resolve({ ok: false, message: "AuthError" }); },
      (r) => !r.ok && isQpsLimit(r.message),
    );
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
  });
});
