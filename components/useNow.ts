import { useSyncExternalStore } from 'react';

/**
 * A shared wall clock for components that show "available again at" times.
 *
 * Returns null on the server and on the first client render, so hydration
 * agrees with the server HTML, then the current time, refreshed every
 * `TICK_MS` while any component is mounted. `refreshNow()` bumps it
 * immediately (after an action that changed a deadline).
 */
const TICK_MS = 30_000;

let current: number | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function refreshNow() {
  current = Date.now();
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  if (current === null) current = Date.now();
  timer ??= setInterval(refreshNow, TICK_MS);
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      current = null;
    }
  };
}

export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

export { refreshNow };
