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
    const stored = localStorage.getItem(lsKey);
    if (stored !== null) {
      return JSON.parse(stored);
    }
    if (legacyKey) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy !== null) {
        localStorage.setItem(lsKey, legacy);
        return JSON.parse(legacy);
      }
    }
    return initial;
  }, [lsKey, legacyKey, initial]);
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
  const setState = (newState: T) => {
    setInternalState(newState);
    localStorage.setItem(lsKey, JSON.stringify(newState));
  };

  return [state, setState];
};
