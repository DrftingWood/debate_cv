/**
 * At most one call in flight. `useTransition`'s `pending` only turns true
 * on the next render, so a fast double press (or a press on a second button
 * beside the first) can start a second request before any button looks
 * busy. This flag is set synchronously, before the first await, so the
 * second press finds it set and does nothing (UX-17: no double submit).
 */
export type SingleFlight = {
  readonly busy: boolean;
  /** Runs `fn` unless a call is already running; then returns `undefined`. */
  run<T>(fn: () => Promise<T>): Promise<T | undefined>;
};

export function singleFlight(): SingleFlight {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
  };
}
