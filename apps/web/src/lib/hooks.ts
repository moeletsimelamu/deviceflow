import { useEffect, useState } from 'react';

/** The value, but only after it has stopped changing for `ms` (for search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * One Idempotency-Key per form submission. The key is created when the form
 * mounts (forms live inside dialogs that remount each time they open), so a
 * double click or a retry of the same submission reuses it and the server
 * applies the change only once. A new form gets a new key.
 */
export function useIdempotencyKey(): string {
  const [key] = useState(() => crypto.randomUUID());
  return key;
}
