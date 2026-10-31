'use client';

import { useId, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { FieldError, fieldInputClass } from '@/components/FieldError';
import { detailsFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';
import type { DetailField, DetailsInput, TournamentDetails } from '@/lib/admin/tournamentDetails';

/**
 * The detail page's "Format, year and region" (POST
 * /api/admin/tournaments/[id]/details). Each field shows whether it was set
 * by hand; a hand-set field is never overwritten by a scrape, and "Not set"
 * hands it back to the automatic fill. Only the fields changed are sent.
 * The vocabularies come from the server so the client bundle carries no
 * database code.
 */
export function TournamentDetailsForm({
  tournamentId,
  tournamentName,
  details,
  formats,
  regions,
  yearRange,
}: {
  tournamentId: string;
  tournamentName: string;
  details: TournamentDetails;
  formats: readonly string[];
  regions: readonly string[];
  yearRange: { min: number; max: number };
}) {
  const errorId = useId();
  const [format, setFormat] = useState(details.format ?? '');
  const [year, setYear] = useState(details.year == null ? '' : String(details.year));
  const [region, setRegion] = useState(details.region ?? '');
  const { submit, error, pending } = useSaveDetails(tournamentId, tournamentName, () =>
    changedDetails(details, { format, year, region }, yearRange),
  );
  const manual = (f: DetailField) => details.manual.includes(f);
  const describedBy = error ? errorId : undefined;

  return (
    <section aria-labelledby="details-heading" className="space-y-inline rounded-lg border p-panel">
      <h2 id="details-heading" className="font-display text-h3 font-medium text-ink">
        Format, year and region
      </h2>
      <p className="max-w-prose text-body text-ink-soft">
        Set any of these by hand. A value set here is kept when the tab is scraped again; choose
        &ldquo;Not set&rdquo; to hand it back to the automatic fill.
      </p>
      <form noValidate onSubmit={submit} className="space-y-inline">
        <div className="flex flex-wrap items-end gap-inline">
          <Field label="Format" manual={manual('format')}>
            {(id) => <Choice id={id} value={format} onChange={setFormat} options={formats} />}
          </Field>
          <Field label="Year" manual={manual('year')}>
            {(id) => (
              <YearInput id={id} value={year} onChange={setYear} describedBy={describedBy} />
            )}
          </Field>
          <Field label="Region" manual={manual('region')}>
            {(id) => <Choice id={id} value={region} onChange={setRegion} options={regions} />}
          </Field>
          <Button type="submit" variant="outline" loading={pending}>
            Save
          </Button>
        </div>
        <div role="alert">{error ? <FieldError id={errorId}>{error}</FieldError> : null}</div>
      </form>
    </section>
  );
}

function Field({
  label,
  manual,
  children,
}: {
  label: string;
  manual: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-hair">
      <label htmlFor={id} className="block text-ui font-medium text-ink">
        {label}
        {manual ? <span className="ml-inline text-caption text-ink-soft">set by hand</span> : null}
      </label>
      {children(id)}
    </div>
  );
}

function YearInput({
  id,
  value,
  onChange,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  describedBy: string | undefined;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={describedBy ? true : undefined}
      aria-describedby={describedBy}
      className={`${fieldInputClass} w-28`}
    />
  );
}

function Choice({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${fieldInputClass} w-auto`}
    >
      <option value="">Not set</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** The fields that differ from the stored ones, or why the year cannot be sent. */
export function changedDetails(
  details: TournamentDetails,
  values: { format: string; year: string; region: string },
  yearRange: { min: number; max: number },
): DetailsInput | string {
  const change: DetailsInput = {};
  if (values.format !== (details.format ?? '')) change.format = values.format || null;
  if (values.region !== (details.region ?? '')) change.region = values.region || null;
  const y = values.year.trim();
  if (y === (details.year == null ? '' : String(details.year))) return change;
  if (y && !/^\d{4}$/.test(y)) return 'Type a four-digit year, or leave it empty.';
  const n = y ? Number(y) : null;
  if (n != null && (n < yearRange.min || n > yearRange.max))
    return `Type a year from ${yearRange.min} to ${yearRange.max}.`;
  change.year = n;
  return change;
}

/** What "Save" does: the changed fields, or a reason it cannot send them. */
function useSaveDetails(
  tournamentId: string,
  tournamentName: string,
  changes: () => DetailsInput | string,
) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [flight] = useState(singleFlight);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || flight.busy) return;
    const change = changes();
    if (typeof change === 'string') {
      setError(change);
      return;
    }
    if (Object.keys(change).length === 0) {
      setError('Nothing changed.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<TournamentDetails>(`/api/admin/tournaments/${tournamentId}/details`, change),
      );
      if (!res) return;
      if (!res.ok) {
        setError(detailsFailureMessage(res));
        return;
      }
      toast.show({ kind: 'success', title: tournamentName, description: 'Saved.' });
      startTransition(() => router.refresh());
    });
  };

  return { submit, error, pending };
}
