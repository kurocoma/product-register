/** 自動保存の状態遷移を純ロジックの状態機械として表す。useAutoSave がこれを駆動する。
 *
 * - version      … 値のスナップショット番号。CHANGE のたびに +1
 * - inFlight     … 送信中の version（送信していないときは null）
 * - savedVersion … 保存に成功した最新の version
 *
 * 保証する性質（machine.test.ts で固定）:
 * - 保存成功後、値が変わらない限り二度と送信しない
 *   （SAVE_OK 後に RETRY_FIRE / TIMER_FIRE が来ても effect は none）
 * - 保存失敗 → scheduleRetry → RETRY_FIRE で startSave（自動リトライ）
 * - 保存中(in-flight)に CHANGE が来たら、その保存の SAVE_OK 後に savedVersion < version を
 *   検知して再度 scheduleSave する（最新値が必ず保存される）
 * - 古い in-flight の SAVE_OK / SAVE_FAIL（version 不一致）は無視し、新しい予約を壊さない
 */

export type AutoSavePhase = "idle" | "scheduled" | "saving" | "saved" | "retry-wait";

export type MachineState = {
  phase: AutoSavePhase;
  version: number;
  inFlight: number | null;
  savedVersion: number;
  retryCount: number;
};

export type MachineEvent =
  | { type: "CHANGE" }
  | { type: "TIMER_FIRE" }
  | { type: "SAVE_OK"; version: number }
  | { type: "SAVE_FAIL"; version: number }
  | { type: "RETRY_FIRE" }
  | { type: "MANUAL_SAVE" };

export type MachineEffect = "none" | "scheduleSave" | "startSave" | "scheduleRetry";

export const INITIAL_STATE: MachineState = {
  phase: "idle",
  version: 0,
  inFlight: null,
  savedVersion: 0,
  retryCount: 0,
};

export function transition(
  s: MachineState,
  e: MachineEvent,
): { state: MachineState; effect: MachineEffect } {
  switch (e.type) {
    case "CHANGE": {
      const version = s.version + 1;
      if (s.inFlight !== null) {
        // 保存中: いま走っている保存の完了(SAVE_OK/SAVE_FAIL)時に
        // savedVersion < version を見て再予約する。ここではタイマーを張らない。
        return { state: { ...s, version }, effect: "none" };
      }
      // idle/saved/scheduled/retry-wait いずれからも保存を予約し直す（デバウンス）
      return { state: { ...s, version, phase: "scheduled" }, effect: "scheduleSave" };
    }

    case "TIMER_FIRE": {
      // 予約中以外の（古い）タイマー発火は無視する。保存成功後の再送も起こさない。
      if (s.phase !== "scheduled" || s.inFlight !== null) return { state: s, effect: "none" };
      if (s.version === s.savedVersion) {
        // 保存すべき差分がない（保存済みと同じバージョン）
        return { state: { ...s, phase: "saved" }, effect: "none" };
      }
      return { state: { ...s, phase: "saving", inFlight: s.version }, effect: "startSave" };
    }

    case "SAVE_OK": {
      // version 不一致（古い in-flight の結果）は無視して現在の状態を守る
      if (s.inFlight === null || e.version !== s.inFlight) return { state: s, effect: "none" };
      const savedVersion = Math.max(s.savedVersion, e.version);
      if (savedVersion < s.version) {
        // 保存中に値が変わっていた → 最新値の保存を予約し直す
        return {
          state: { ...s, phase: "scheduled", inFlight: null, savedVersion, retryCount: 0 },
          effect: "scheduleSave",
        };
      }
      return {
        state: { ...s, phase: "saved", inFlight: null, savedVersion, retryCount: 0 },
        effect: "none",
      };
    }

    case "SAVE_FAIL": {
      if (s.inFlight === null || e.version !== s.inFlight) return { state: s, effect: "none" };
      if (e.version < s.version) {
        // 失敗したが既により新しい値がある → リトライではなく最新値の保存を予約する
        return {
          state: { ...s, phase: "scheduled", inFlight: null, retryCount: s.retryCount + 1 },
          effect: "scheduleSave",
        };
      }
      return {
        state: { ...s, phase: "retry-wait", inFlight: null, retryCount: s.retryCount + 1 },
        effect: "scheduleRetry",
      };
    }

    case "RETRY_FIRE": {
      // リトライ待ち以外での（古い）リトライ発火は無視する（保存成功後の再送防止）
      if (s.phase !== "retry-wait" || s.inFlight !== null) return { state: s, effect: "none" };
      if (s.version === s.savedVersion) {
        return { state: { ...s, phase: "saved" }, effect: "none" };
      }
      return { state: { ...s, phase: "saving", inFlight: s.version }, effect: "startSave" };
    }

    case "MANUAL_SAVE": {
      // 送信中の二重送信はしない（完了時に必要なら再予約される）
      if (s.inFlight !== null) return { state: s, effect: "none" };
      // 手動保存は差分がなくても強制的に保存する（従来の「💾 保存」ボタンと同じ挙動）
      return { state: { ...s, phase: "saving", inFlight: s.version }, effect: "startSave" };
    }
  }
}

/** 保存待ち・保存中・失敗リトライ待ちなら true（beforeunload で確認を出す）。 */
export function shouldBlockUnload(s: MachineState): boolean {
  return s.phase === "scheduled" || s.phase === "saving" || s.phase === "retry-wait";
}
