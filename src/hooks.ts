import { useState, useMemo, useEffect, useCallback } from "react";

export const usePersistentState = <T = unknown>(
  key: string,
  initial: T,
  pollInterval: number = 0,
  // Old (e.g. unprefixed) key to fall back to when `key` has no stored value.
  // Used to migrate a value to a new key without resetting saved state. The
  // migrated value is written under the new key on first read; the old entry
  // is left untouched.
  migrateFrom?: string
): [T, (newState: T) => void] => {
  const lsKey = `persistentState/${key}`;
  const legacyKey = migrateFrom ? `persistentState/${migrateFrom}` : undefined;
  const getStoredOrInitial = useCallback((): T => {
    // A corrupt entry must not take down the whole frontend on every load —
    // fall back to the default instead of letting JSON.parse throw mid-render.
    try {
      const stored = localStorage.getItem(lsKey);
      if (stored !== null) {
        return JSON.parse(stored);
      }
      if (legacyKey) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy !== null) {
          // Parse before copying, so a corrupt legacy value isn't migrated.
          const parsed = JSON.parse(legacy);
          localStorage.setItem(lsKey, legacy);
          return parsed;
        }
      }
    } catch (error) {
      console.error(`Corrupt persisted state for "${key}"; using default`, error);
    }
    return initial;
  }, [lsKey, legacyKey, key, initial]);
  const internalInitial = useMemo(() => getStoredOrInitial(), [getStoredOrInitial]);

  const [state, setInternalState] = useState<T>(internalInitial);
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (pollInterval > 0) {
      intervalId = setInterval(
        () => setInternalState(getStoredOrInitial()),
        pollInterval
      );
    }
    return () => {
      if (pollInterval > 0) {
        clearInterval(intervalId);
      }
    };
  }, [pollInterval, getStoredOrInitial]);
  // Stable identity: this setter is passed into memo()ed sections (tempo,
  // measures grid), and a fresh function each render would defeat them.
  const setState = useCallback(
    (newState: T) => {
      setInternalState(newState);
      localStorage.setItem(lsKey, JSON.stringify(newState));
    },
    [lsKey]
  );

  return [state, setState];
};
