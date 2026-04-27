'use client';

import { useMemo, useState, useTransition } from 'react';
import { AlertCircle, Download, Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type FeedbackTournament = {
  id: string;
  name: string;
  year: number | null;
  roles: string[];
};

type ReportResponse = {
  id: string;
  tournamentCount: number;
};

export function CvErrorReportForm({ tournaments }: { tournaments: FeedbackTournament[] }) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [comment, setComment] = useState('');

  const selectedIds = useMemo(() => [...selected], [selected]);
  if (tournaments.length === 0) return null;

  return (
    <section className="rounded-card border border-warning/30 bg-warning/5 p-4 md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-warning" aria-hidden />
            <h2 className="font-display text-h4 font-semibold text-foreground">Report incorrect CV output</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => {
              const checked = selected.has(t.id);
              return (
                <label
                  key={t.id}
                  className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-border bg-card/70 px-3 py-2 text-[13px] transition-colors hover:bg-card"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.currentTarget.checked) next.add(t.id);
                      else next.delete(t.id);
                      setSelected(next);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-border text-primary"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{t.name}</span>
                    <span className="block truncate text-caption text-muted-foreground">
                      {[t.year ?? null, t.roles.join(' + ')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <form
          className="w-full space-y-2 lg:w-[360px]"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await postJson<ReportResponse>('/api/cv/error-report', {
                tournamentIds: selectedIds,
                comment,
              });
              if (!result.ok) {
                toast.show({
                  kind: 'error',
                  title: 'Report not sent',
                  description: result.error,
                });
                return;
              }
              setSelected(new Set());
              setComment('');
              toast.show({
                kind: 'success',
                title: 'Report sent',
                description: `${result.data.tournamentCount} ${result.data.tournamentCount === 1 ? 'tournament' : 'tournaments'} attached.`,
              });
            });
          }}
        >
          <textarea
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
            rows={5}
            maxLength={4000}
            placeholder="Tell us what looks wrong."
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-muted-foreground">
              {selectedIds.length} selected
            </span>
            <div className="flex items-center gap-2">
              <a
                href="/api/cv/error-report/export"
                className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-transparent px-3.5 text-[13px] font-medium text-foreground transition-all duration-[180ms] ease-soft hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export
              </a>
              <Button
                type="submit"
                size="sm"
                loading={isPending}
                disabled={selectedIds.length === 0 || comment.trim().length < 8}
                leftIcon={!isPending ? <Send className="h-3.5 w-3.5" aria-hidden /> : undefined}
              >
                Send report
              </Button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
