'use client';

import { createContext, useContext } from 'react';
import type { SingleFlight } from '@/lib/utils/singleFlight';

/**
 * The one in-flight action of an /admin table (UX-17). Mark checked, Undo,
 * Fix, Review later and the bulk retries all run through the flight a
 * CheckActionsProvider hands down, so pressing one while another runs does
 * nothing, whichever row or bar it is on. A control used outside a provider
 * (the Inbox's Fix) keeps a flight of its own.
 */
export const PageFlightContext = createContext<SingleFlight | null>(null);

/** The page's shared flight, else `own`. */
export function usePageFlight(own: SingleFlight): SingleFlight {
  return useContext(PageFlightContext) ?? own;
}
