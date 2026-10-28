'use client';

import { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button, buttonClasses } from '@/components/ui/Button';
import { usePopover } from '@/components/ui/usePopover';
import { EXPORT_FIELDS, EXPORT_FIELD_IDS } from '@/lib/cv/exportFields';

type ExportFormat = 'csv' | 'xlsx';

type StoredPrefs = {
  format: ExportFormat;
  fields: string[];
};

// localStorage, not a DB column: export preferences are a per-device
// convenience, and keeping them client-side avoids a migration + API for
// something with no cross-device stakes. Versioned key so a future shape
// change can just switch keys instead of migrating stored blobs.
const PREFS_KEY = 'cv-export-prefs.v1';

function loadPrefs(): StoredPrefs | null {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    if (parsed.format !== 'csv' && parsed.format !== 'xlsx') return null;
    if (!Array.isArray(parsed.fields)) return null;
    const known = new Set(EXPORT_FIELD_IDS);
    return {
      format: parsed.format,
      fields: parsed.fields.filter((f): f is string => typeof f === 'string' && known.has(f)),
    };
  } catch {
    return null;
  }
}

/**
 * Single "Download" popover for every get-my-CV-out-of-the-app action:
 * print-to-PDF on top (the most common ask), then the column picker +
 * CSV/Excel export below. Replaces the previous pair of side-by-side
 * buttons ("Print to PDF" + "Export") that shared the same icon and
 * competed for the same mental slot. The data download itself is a plain
 * navigation to /api/cv/export — the route streams the file with
 * Content-Disposition, so no blob handling here.
 */
export function CvDownloadButton() {
  const { open, setOpen, containerRef, triggerRef, panelRef } = usePopover();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selected, setSelected] = useState<Set<string>>(new Set(EXPORT_FIELD_IDS));

  useEffect(() => {
    const prefs = loadPrefs();
    if (!prefs) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- saved prefs live in localStorage, which the server cannot render, so they are applied after hydration
    setFormat(prefs.format);
    if (prefs.fields.length > 0) setSelected(new Set(prefs.fields));
  }, []);

  const persist = (nextFormat: ExportFormat, nextSelected: Set<string>) => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ format: nextFormat, fields: [...nextSelected] } satisfies StoredPrefs),
      );
    } catch {
      // Storage full / blocked — prefs just won't stick, the export still works.
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist(format, next);
      return next;
    });
  };

  const setAll = (on: boolean) => {
    const next = on ? new Set(EXPORT_FIELD_IDS) : new Set<string>();
    setSelected(next);
    persist(format, next);
  };

  const pickFormat = (f: ExportFormat) => {
    setFormat(f);
    persist(f, selected);
  };

  const download = () => {
    const params = new URLSearchParams({ format });
    // All fields selected is the server default — omit the param so the
    // URL stays the canonical short form.
    if (selected.size < EXPORT_FIELD_IDS.length) {
      params.set('fields', EXPORT_FIELD_IDS.filter((id) => selected.has(id)).join(','));
    }
    window.location.assign(`/api/cv/export?${params.toString()}`);
    setOpen(false);
  };

  const printPdf = () => {
    // Close first so the popover (data-print-hide'd anyway) isn't part of
    // the print snapshot, then let the dialog take over.
    setOpen(false);
    if (typeof window !== 'undefined') window.print();
  };

  const groups: { title: string; ids: string[] }[] = [
    {
      title: 'General',
      ids: EXPORT_FIELDS.filter((f) => f.speaker && f.judge).map((f) => f.id),
    },
    {
      title: 'Speaking',
      ids: EXPORT_FIELDS.filter((f) => f.speaker && !f.judge).map((f) => f.id),
    },
    {
      title: 'Judging',
      ids: EXPORT_FIELDS.filter((f) => !f.speaker && f.judge).map((f) => f.id),
    },
  ];
  const labelById = new Map(EXPORT_FIELDS.map((f) => [f.id, f.label]));

  return (
    <div ref={containerRef} className="relative" data-print-hide="true">
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="outline"
        leftIcon={<Download className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        Download
      </Button>
      {open ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-label="Download your CV"
          className="absolute right-0 z-30 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-card outline-none border border-border bg-card p-4 shadow-lg"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <div className="text-caption font-medium text-ink">PDF</div>
                <p className="text-byline text-ink-soft">Via your browser&rsquo;s print dialog.</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                leftIcon={<Printer className="h-3.5 w-3.5" aria-hidden />}
                onClick={printPdf}
              >
                Print to PDF
              </Button>
            </div>

            <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <div className="text-caption font-medium text-ink">JSON Resume</div>
                <p className="text-byline text-ink-soft">For resume themes and portfolio sites.</p>
              </div>
              {/* A GET that downloads a file is a link, not a button (NV-29). */}
              <a
                href="/api/cv/export?format=json-resume"
                download
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
                onClick={() => setOpen(false)}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Download JSON Resume
              </a>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-medium text-ink">Data export — columns</span>
              {/* min-h-6 + padding: bare text, these were ~15×18 px, under
                  the 24 px target floor (CV-5, WCAG 2.5.8). */}
              <span className="flex gap-1 text-caption">
                <button
                  type="button"
                  className="min-h-6 rounded px-1.5 text-primary hover:underline coarse:min-h-11"
                  onClick={() => setAll(true)}
                >
                  All
                </button>
                <button
                  type="button"
                  className="min-h-6 rounded px-1.5 text-primary hover:underline coarse:min-h-11"
                  onClick={() => setAll(false)}
                >
                  None
                </button>
              </span>
            </div>

            <div className="max-h-[260px] space-y-3 overflow-y-auto pr-1">
              {groups.map((g) =>
                g.ids.length > 0 ? (
                  <fieldset key={g.title}>
                    <legend className="text-byline uppercase tracking-[0.12em] text-ink-soft">
                      {g.title}
                    </legend>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {g.ids.map((id) => (
                        <label
                          key={id}
                          className="flex cursor-pointer items-center gap-2 text-caption text-ink"
                        >
                          <input
                            type="checkbox"
                            className="h-6 w-6 shrink-0 accent-primary"
                            checked={selected.has(id)}
                            onChange={() => toggle(id)}
                          />
                          <span className="truncate" title={labelById.get(id)}>
                            {labelById.get(id)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null,
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <div role="radiogroup" aria-label="File format" className="flex gap-3 text-caption">
                {(['csv', 'xlsx'] as const).map((f) => (
                  <label key={f} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="cv-export-format"
                      className="h-4 w-4 accent-primary"
                      checked={format === f}
                      onChange={() => pickFormat(f)}
                    />
                    {f === 'csv' ? 'CSV' : 'Excel'}
                  </label>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={selected.size === 0}
                aria-describedby={selected.size === 0 ? 'cv-export-no-columns' : undefined}
                onClick={download}
              >
                Download
              </Button>
            </div>
            {/* The button stays disabled with nothing to export, but now says
                why, visibly and to a screen reader (FORM-7). */}
            {selected.size === 0 ? (
              <p id="cv-export-no-columns" className="text-caption text-ink-soft">
                Tick at least one column to download a data file.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
