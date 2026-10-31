'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { FieldError, fieldInputClass } from '@/components/FieldError';
import { tabMoveFailureMessage } from '@/lib/admin/actionMessage';
import { postJson } from '@/lib/utils/api';
import { singleFlight } from '@/lib/utils/singleFlight';

/**
 * "Add a moved tab" (POST /api/admin/tab-moves): the tab's old address and
 * its new one. Any URL on either tab will do; only the site and slug are
 * kept. Checked on press (UX-16); success is a toast saying how many failed
 * imports went back in the queue.
 */
export function TabMoveForm() {
  const errorId = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { submit, error, pending } = useAddMove(from, to, () => {
    setFrom('');
    setTo('');
  });
  const describedBy = error ? errorId : undefined;

  return (
    <form noValidate onSubmit={submit} className="space-y-inline">
      <div className="flex flex-wrap items-end gap-inline">
        <MoveField label="Old address" value={from} onChange={setFrom} describedBy={describedBy} />
        <MoveField label="New address" value={to} onChange={setTo} describedBy={describedBy} />
        <Button type="submit" variant="outline" loading={pending}>
          Add move
        </Button>
      </div>
      <div role="alert">{error ? <FieldError id={errorId}>{error}</FieldError> : null}</div>
    </form>
  );
}

function MoveField({
  label,
  value,
  onChange,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  describedBy: string | undefined;
}) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1 space-y-hair sm:min-w-72">
      <label htmlFor={id} className="block text-ui font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={describedBy ? true : undefined}
        aria-describedby={describedBy}
        className={fieldInputClass}
      />
    </div>
  );
}

/** What "Add move" does with the two addresses. */
function useAddMove(from: string, to: string, onAdded: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [flight] = useState(singleFlight);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || flight.busy) return;
    const problem = !from.trim() || !to.trim() ? 'Fill in both addresses.' : null;
    setError(problem);
    if (problem) return;
    startTransition(async () => {
      const res = await flight.run(() =>
        postJson<{ added: boolean; requeued: number }>('/api/admin/tab-moves', {
          from: from.trim(),
          to: to.trim(),
        }),
      );
      if (!res) return;
      if (!res.ok) {
        setError(tabMoveFailureMessage(res));
        return;
      }
      const n = res.data.requeued;
      toast.show({
        kind: 'success',
        title: 'Move saved',
        description:
          n === 0
            ? 'No failed imports were waiting on the old address.'
            : `${n} failed ${n === 1 ? 'import' : 'imports'} from the old address queued again.`,
      });
      onAdded();
      startTransition(() => router.refresh());
    });
  };

  return { submit, error, pending };
}
