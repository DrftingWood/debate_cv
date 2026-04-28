'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type ScanResponse = {
  scanned: number;
  found: number;
};

/**
 * Fire-and-forget auto-scan on page load. Removes the "user has to remember
 * to click Scan Gmail" failure mode from the dashboard / CV without adding
 * any new infrastructure: hits the same /api/ingest/gmail endpoint as the
 * manual button, relies on the existing 5-minute cooldown to throttle.
 *
 * Runs once per mount. Cooldown rejection (HTTP 429) is treated as a
 * silent no-op — no toast, no log noise — since it's the expected path on
 * frequent visits. Only surfaces a toast when new URLs were actually
 * found, so the typical zero-delta visit stays quiet.
 *
 * The session-storage flag prevents the same browser tab from re-running
 * the scan on every soft client-side navigation; the cooldown plus the
 * flag together cover both fresh page loads and SPA navigations.
 */
export function AutoScanOnVisit() {
  const router = useRouter();
  const toast = useToast();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // Only run once per session per origin to avoid re-firing on every soft
    // navigation. The 5-min server-side cooldown is the real guardrail; this
    // is just a polite client-side dedup.
    const SESSION_KEY = 'autoScanOnVisit:lastTriggeredAt';
    const COOLDOWN_MS = 5 * 60 * 1000;
    try {
      const last = window.sessionStorage.getItem(SESSION_KEY);
      if (last && Date.now() - Number(last) < COOLDOWN_MS) return;
      window.sessionStorage.setItem(SESSION_KEY, String(Date.now()));
    } catch {
      // sessionStorage may be unavailable in some embeds; proceed anyway.
    }

    void (async () => {
      const res = await postJson<ScanResponse>('/api/ingest/gmail');
      if (!res.ok) {
        // Silent on cooldown / unauthorized / no-token. Other failures are
        // operational noise the user can't act on here either.
        return;
      }
      const found = res.data.found ?? 0;
      if (found > 0) {
        toast.show({
          kind: 'success',
          title: 'Found new private URLs',
          description: `${found} ${found === 1 ? 'URL' : 'URLs'} added to your queue.`,
        });
        router.refresh();
      }
    })();
  }, [router, toast]);

  return null;
}
