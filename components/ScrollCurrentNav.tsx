'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * A <nav> that keeps its current item in view when it overflows sideways on
 * a phone (UX-55): the current item used to be able to sit behind the edge
 * fade. `block: 'nearest'` keeps the page itself from scrolling. Server
 * components (CvSubNav, the app shell) use this instead of a bare <nav>.
 */
export function ScrollCurrentNav({ children, ...rest }: React.ComponentPropsWithoutRef<'nav'>) {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const current = ref.current?.querySelector('[aria-current]') as HTMLElement | null;
    current?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [pathname]);
  return (
    <nav ref={ref} {...rest}>
      {children}
    </nav>
  );
}
