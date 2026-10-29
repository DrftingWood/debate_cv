'use client';

import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

/**
 * A headline figure that counts up once per browser session (redesign owner
 * decision 23, design §6): at most 600 ms, ease-out, and never again for the
 * same `id` until the session ends, so a return visit is still.
 *
 * The server renders the final value, so it is right without JS, in print
 * and for a screen reader. The count runs only when motion is allowed: with
 * `prefers-reduced-motion: reduce` the final value stays as rendered. The
 * number is announced once, as the final value: the counting copy is
 * aria-hidden, so a screen reader never reads the intermediate digits.
 */
const DURATION_MS = 600;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/*
 * On a full page load the server's final figure is painted before this code
 * runs, so counting from 0 would show the number, drop it to 0 and climb
 * back: a flicker, not motion. So a hydrating figure counts only when the
 * page hydrated within FLASH_MS of its first paint (too quick to see). A
 * figure mounted by a client navigation always counts: React sets 0 before
 * the browser paints it. `useSyncExternalStore` tells the two apart: it
 * returns the server snapshot only while hydrating.
 */
const FLASH_MS = 150;
const noop = () => () => {};

function paintedTooLongAgo(): boolean {
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
  return fcp != null && performance.now() - fcp > FLASH_MS;
}

export function CountUp({ value, id }: { value: number; id: string }) {
  const [shown, setShown] = useState(value);
  const [counting, setCounting] = useState(false);
  const hydrating = useSyncExternalStore(
    noop,
    () => false,
    () => true,
  );

  // Layout effect: decide before the first client paint, so a figure that
  // is going to count starts at 0 instead of flashing the final value twice.
  useLayoutEffect(() => {
    const key = `debate-cv:count-up:${id}`;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(key) === '1';
    } catch {
      // Storage blocked: count every time rather than fail.
    }
    if (reduce || seen || value <= 0 || (hydrating && paintedTooLongAgo())) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setShown(Math.round(easeOut(t) * value));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      setCounting(false);
      // Marked seen only once the count has finished: an effect torn down
      // mid-count (React's development double run, a fast navigation)
      // leaves it unmarked, so the next mount counts again from the start.
      try {
        window.sessionStorage.setItem(key, '1');
      } catch {
        // Storage blocked: nothing to remember.
      }
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the count has to start from 0 before the first paint; this is the one place it can be set
    setCounting(true);
    setShown(0);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // Torn down mid-count: show the real figure, never a frozen partial one.
      setCounting(false);
      setShown(value);
    };
    // `hydrating` is read once, for the mount: it flips to false right after
    // hydration and must not restart the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [id, value]);

  if (!counting) return <>{value}</>;
  return (
    <>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}
