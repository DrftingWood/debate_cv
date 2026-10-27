'use client';

import { useEffect, useRef } from 'react';

/**
 * Renders nothing; on mount it moves focus to its parent element.
 *
 * For a disclosure built from a navigation (`<Link scroll={false}>`) rather
 * than `<details>`: the link the user activated is replaced by the content it
 * opened, so focus falls back to <body> and a keyboard user starts again from
 * the top of the page (ADM-9). The parent should carry a role and a name.
 * `preventScroll` keeps the page where `scroll={false}` left it.
 */
export function FocusOnMount() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    if (!parent.hasAttribute('tabindex')) parent.setAttribute('tabindex', '-1');
    parent.focus({ preventScroll: true });
  }, []);
  return <span ref={ref} hidden />;
}
