"use client";

import { useCallback, useEffect, useState } from "react";
import { STORAGE_EVENT } from "./storage";

/**
 * Loads a value through an async storage getter and reloads it whenever any
 * storage write happens (same tab) or another tab changes localStorage.
 * `loading` is true until the first read completes (avoids empty-state flashes).
 */
export function useStoredValue<T>(loader: () => Promise<T>, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setValue(await loader());
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    void reload();
    window.addEventListener(STORAGE_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(STORAGE_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [reload]);

  return { value, loading, reload };
}
