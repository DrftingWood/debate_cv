import Link from 'next/link';
import { adminTabHref, type AdminTab } from '@/lib/admin/adminTabs';
import type { Summary } from '@/lib/admin/summary';

const count = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-GB'));

/**
 * "Needs you N · Accuracy S (Good g · Check c · Re-scrape r) · Imports
 * to review N · Queue N": the only figures above the tabs (spec 2026-10-31, "No
 * other tiles"). Each links to the tab it counts. Plain text with separators,
 * not tiles: the numbers are the same ones the tabs show, said once.
 */
export function SummaryLine({ summary }: { summary: Summary }) {
  const a = summary.accuracy;
  // A failed read shows a dash; say why, so a dash is not mistaken for zero.
  const unavailable =
    a === null ||
    summary.needsYou === null ||
    summary.importsFailing === null ||
    summary.queue === null;
  return (
    <p role="group" aria-label="Summary" className="text-body text-ink-soft">
      <Figure tab="inbox" label="Needs you" value={count(summary.needsYou)} />
      <Sep />
      <Figure
        tab="tournaments"
        label="Accuracy"
        value={a ? (a.score === null ? '—' : String(a.score)) : '—'}
      />
      {a ? (
        <>
          {' '}
          (Good {count(a.good)} <Dot /> Check {count(a.check)} <Dot /> Re-scrape {count(a.rescrape)}
          )
        </>
      ) : null}
      <Sep />
      <Figure tab="imports" label="Imports to review" value={count(summary.importsFailing)} />
      <Sep />
      <Figure tab="tools" label="Queue" value={count(summary.queue)} />
      {unavailable ? (
        <>
          <Sep />
          <span role="status">Counts unavailable</span>
        </>
      ) : null}
    </p>
  );
}

function Figure({ tab, label, value }: { tab: AdminTab; label: string; value: string }) {
  return (
    <Link
      href={adminTabHref(tab)}
      className="text-ink underline-offset-4 hover:text-primary hover:underline"
    >
      {label} <span className="num font-medium">{value}</span>
    </Link>
  );
}

const Dot = () => <span aria-hidden>·</span>;
const Sep = () => <span aria-hidden> · </span>;
