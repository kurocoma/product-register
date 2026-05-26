"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutoSave<T>(
  value: T,
  onSave: (v: T) => Promise<void>,
  delayMs = 800,
) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await onSave(value);
        setStatus("saved");
        setSavedAt(new Date());
      } catch (e) {
        console.error("auto-save failed", e);
        setStatus("error");
      }
    }, delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const manualSave = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("saving");
    try {
      await onSave(value);
      setStatus("saved");
      setSavedAt(new Date());
    } catch (e) {
      console.error("manual save failed", e);
      setStatus("error");
    }
  }, [onSave, value]);

  return { status, savedAt, manualSave };
}
