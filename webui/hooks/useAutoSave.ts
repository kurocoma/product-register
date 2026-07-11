"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_STATE,
  shouldBlockUnload,
  transition,
  type MachineEvent,
  type MachineState,
} from "@/lib/autosave/machine";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

/** 保存失敗時の自動リトライ間隔 (ms)。 */
export const AUTO_SAVE_RETRY_MS = 5000;

/** 値変更のデバウンス自動保存 + 失敗の自動リトライ + 離脱ガード。
 * 状態遷移は lib/autosave/machine.ts の純ロジック状態機械（transition）が決め、
 * この hook はタイマー・fetch・beforeunload という副作用だけを実行する。 */
export function useAutoSave<T>(
  value: T,
  onSave: (v: T) => Promise<void>,
  delayMs = 800,
  options?: {
    /** false の間は自動保存を予約しない（手動保存 manualSave は常に有効）。
     * 新規商品で必須(NEコード)未入力のままエラーを出し続けないためのゲート。既定 true = 従来動作。 */
    enabled?: boolean;
  },
) {
  const enabled = options?.enabled ?? true;
  const [state, setState] = useState<MachineState>(INITIAL_STATE);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stateRef = useRef<MachineState>(INITIAL_STATE);
  const valueRef = useRef(value);
  const onSaveRef = useRef(onSave);
  const dispatchRef = useRef<(e: MachineEvent) => void>(() => {});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRun = useRef(true);

  // 最新の値・保存関数をタイマー/非同期完了時に参照できるようにする（render中はrefへ書かない）
  useEffect(() => {
    valueRef.current = value;
    onSaveRef.current = onSave;
  }, [value, onSave]);

  const clearTimers = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const errMsg = (e: unknown) =>
    e instanceof Error ? e.message : typeof e === "string" ? e : "保存に失敗しました";

  /** 状態機械へイベントを流し、返ってきた effect（タイマー予約・保存実行）を実行する。 */
  const dispatch = useCallback(
    (event: MachineEvent) => {
      const { state: next, effect } = transition(stateRef.current, event);
      stateRef.current = next;
      setState(next);
      if (effect === "none") return;
      clearTimers();
      if (effect === "scheduleSave") {
        saveTimerRef.current = setTimeout(
          () => dispatchRef.current({ type: "TIMER_FIRE" }),
          delayMs,
        );
      } else if (effect === "scheduleRetry") {
        retryTimerRef.current = setTimeout(
          () => dispatchRef.current({ type: "RETRY_FIRE" }),
          AUTO_SAVE_RETRY_MS,
        );
      } else if (effect === "startSave") {
        const version = next.inFlight ?? next.version;
        const snapshot = valueRef.current;
        void (async () => {
          try {
            await onSaveRef.current(snapshot);
            setSavedAt(new Date());
            setErrorMessage(null);
            dispatchRef.current({ type: "SAVE_OK", version });
          } catch (e) {
            console.error("auto-save failed", e);
            setErrorMessage(errMsg(e));
            dispatchRef.current({ type: "SAVE_FAIL", version });
          }
        })();
      }
    },
    [delayMs],
  );

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // 値の変更を状態機械へ通知する（初回マウントでは保存しない）
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!enabled) {
      // 無効中は予約しない。予約済み・リトライ待ちがあれば解除して idle に戻す
      clearTimers();
      const cur = stateRef.current;
      if (cur.phase === "scheduled" || cur.phase === "retry-wait") {
        const next: MachineState = { ...cur, phase: "idle" };
        stateRef.current = next;
        setState(next);
      }
      return;
    }
    dispatch({ type: "CHANGE" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);

  // アンマウント時にタイマーを解放する
  useEffect(() => () => clearTimers(), []);

  // 保存待ち・保存中・リトライ待ちのままページを閉じる/リロードしようとしたら確認を出す
  const blocking = shouldBlockUnload(state);
  useEffect(() => {
    if (!blocking) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // Chrome 互換: これで「保存されていない変更があります」確認が出る
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [blocking]);

  const manualSave = useCallback(async () => {
    dispatch({ type: "MANUAL_SAVE" });
  }, [dispatch]);

  // 既存UI互換のステータス（retry-wait は "error" 扱い = 赤帯を出したまま自動リトライ）
  const status: AutoSaveStatus =
    state.phase === "saving"
      ? "saving"
      : state.phase === "retry-wait"
        ? "error"
        : state.phase === "saved"
          ? "saved"
          : errorMessage
            ? "error"
            : savedAt
              ? "saved"
              : "idle";

  return { status, savedAt, errorMessage, manualSave, blocking };
}
