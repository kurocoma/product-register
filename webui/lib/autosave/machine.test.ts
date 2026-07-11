import { describe, it, expect } from "vitest";
import {
  INITIAL_STATE,
  transition,
  shouldBlockUnload,
  type MachineEvent,
  type MachineState,
} from "./machine";

/** イベント列を順に適用し、最終状態と各遷移の effect 列を返す。 */
function run(events: MachineEvent[], from: MachineState = INITIAL_STATE) {
  let state = from;
  const effects: string[] = [];
  for (const e of events) {
    const r = transition(state, e);
    state = r.state;
    effects.push(r.effect);
  }
  return { state, effects };
}

describe("autosave 状態機械（lib/autosave/machine）", () => {
  it("変更 → タイマー発火で保存を開始する", () => {
    const { state, effects } = run([{ type: "CHANGE" }, { type: "TIMER_FIRE" }]);
    expect(effects).toEqual(["scheduleSave", "startSave"]);
    expect(state.phase).toBe("saving");
    expect(state.inFlight).toBe(1);
  });

  it("保存成功後、値が変わらない限り二度と送信しない（SAVE_OK 後の RETRY_FIRE/TIMER_FIRE は none）", () => {
    const { state } = run([
      { type: "CHANGE" },
      { type: "TIMER_FIRE" },
      { type: "SAVE_OK", version: 1 },
    ]);
    expect(state.phase).toBe("saved");
    expect(state.savedVersion).toBe(1);

    const retry = transition(state, { type: "RETRY_FIRE" });
    expect(retry.effect).toBe("none");
    expect(retry.state).toEqual(state);

    const timer = transition(state, { type: "TIMER_FIRE" });
    expect(timer.effect).toBe("none");
    expect(timer.state).toEqual(state);
  });

  it("保存失敗 → scheduleRetry → RETRY_FIRE で自動リトライ（startSave）", () => {
    const failed = run([
      { type: "CHANGE" },
      { type: "TIMER_FIRE" },
      { type: "SAVE_FAIL", version: 1 },
    ]);
    expect(failed.effects[2]).toBe("scheduleRetry");
    expect(failed.state.phase).toBe("retry-wait");
    expect(failed.state.retryCount).toBe(1);
    expect(failed.state.inFlight).toBeNull();

    const retried = transition(failed.state, { type: "RETRY_FIRE" });
    expect(retried.effect).toBe("startSave");
    expect(retried.state.phase).toBe("saving");
    expect(retried.state.inFlight).toBe(1);

    // リトライ成功で saved に戻り retryCount がリセットされる
    const ok = transition(retried.state, { type: "SAVE_OK", version: 1 });
    expect(ok.state.phase).toBe("saved");
    expect(ok.state.retryCount).toBe(0);
    expect(shouldBlockUnload(ok.state)).toBe(false);
  });

  it("保存中の CHANGE → その保存の SAVE_OK 後に再予約され、最新値が保存される", () => {
    const { state, effects } = run([
      { type: "CHANGE" }, // version 1
      { type: "TIMER_FIRE" }, // saving v1
      { type: "CHANGE" }, // version 2（in-flight 中はタイマーを張らない）
      { type: "SAVE_OK", version: 1 },
    ]);
    expect(effects[2]).toBe("none");
    expect(effects[3]).toBe("scheduleSave"); // savedVersion(1) < version(2) → 再予約
    expect(state.phase).toBe("scheduled");
    expect(state.savedVersion).toBe(1);
    expect(state.version).toBe(2);

    // 再予約のタイマー発火で最新版 v2 を保存する
    const next = transition(state, { type: "TIMER_FIRE" });
    expect(next.effect).toBe("startSave");
    expect(next.state.inFlight).toBe(2);
  });

  it("保存中に CHANGE があって失敗した場合も、リトライではなく最新値の保存を予約する", () => {
    const { state, effects } = run([
      { type: "CHANGE" },
      { type: "TIMER_FIRE" },
      { type: "CHANGE" },
      { type: "SAVE_FAIL", version: 1 },
    ]);
    expect(effects[3]).toBe("scheduleSave");
    expect(state.phase).toBe("scheduled");
  });

  it("古い in-flight の SAVE_OK / SAVE_FAIL（version 不一致）は無視し、新しい予約・送信を壊さない", () => {
    // v2 を保存中の状態を作る
    const { state: saving2 } = run([
      { type: "CHANGE" }, // v1
      { type: "TIMER_FIRE" }, // saving v1
      { type: "CHANGE" }, // v2
      { type: "SAVE_OK", version: 1 }, // → scheduled(v2)
      { type: "TIMER_FIRE" }, // saving v2
    ]);
    expect(saving2.inFlight).toBe(2);

    const staleOk = transition(saving2, { type: "SAVE_OK", version: 1 });
    expect(staleOk.effect).toBe("none");
    expect(staleOk.state).toEqual(saving2);

    const staleFail = transition(saving2, { type: "SAVE_FAIL", version: 1 });
    expect(staleFail.effect).toBe("none");
    expect(staleFail.state).toEqual(saving2);

    // in-flight なし（scheduled）でも古い結果は無視する
    const { state: scheduled } = run([
      { type: "CHANGE" },
      { type: "TIMER_FIRE" },
      { type: "CHANGE" },
      { type: "SAVE_OK", version: 1 }, // → scheduled(v2)
    ]);
    const staleOk2 = transition(scheduled, { type: "SAVE_OK", version: 1 });
    expect(staleOk2.effect).toBe("none");
    expect(staleOk2.state).toEqual(scheduled);
  });

  it("MANUAL_SAVE は即時保存を開始し、送信中の二重送信はしない", () => {
    const manual = transition(run([{ type: "CHANGE" }]).state, { type: "MANUAL_SAVE" });
    expect(manual.effect).toBe("startSave");
    expect(manual.state.phase).toBe("saving");

    const during = transition(manual.state, { type: "MANUAL_SAVE" });
    expect(during.effect).toBe("none");
  });

  it("shouldBlockUnload: scheduled / saving / retry-wait は true、idle / saved は false", () => {
    expect(shouldBlockUnload(INITIAL_STATE)).toBe(false); // idle

    const scheduled = run([{ type: "CHANGE" }]).state;
    expect(scheduled.phase).toBe("scheduled");
    expect(shouldBlockUnload(scheduled)).toBe(true);

    const saving = run([{ type: "CHANGE" }, { type: "TIMER_FIRE" }]).state;
    expect(saving.phase).toBe("saving");
    expect(shouldBlockUnload(saving)).toBe(true);

    const retryWait = run([
      { type: "CHANGE" },
      { type: "TIMER_FIRE" },
      { type: "SAVE_FAIL", version: 1 },
    ]).state;
    expect(retryWait.phase).toBe("retry-wait");
    expect(shouldBlockUnload(retryWait)).toBe(true);

    const saved = run([
      { type: "CHANGE" },
      { type: "TIMER_FIRE" },
      { type: "SAVE_OK", version: 1 },
    ]).state;
    expect(saved.phase).toBe("saved");
    expect(shouldBlockUnload(saved)).toBe(false);
  });
});
