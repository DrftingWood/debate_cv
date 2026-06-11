'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
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
 * "Export…" popover for the /cv header: pick which columns to include and
 * whether to download CSV or Excel. The download itself is a plain
 * navigation to /api/cv/export with query params — the route streams the
 * file with Content-Disposition, so no blob handling here.
 */
export function CvExportButton() {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selected, setSelected] = useState<Set<string>>(new Set(EXPORT_FIELD_IDS));
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prefs = loadPrefs();
    if (!prefs) return;
    setFormat(prefs.format);
    if (prefs.fields.length > 0) setSelected(new Set(prefs.fields));
  }, []);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKeydown);
    };
  }, [open]);

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
        type="button"
        size="sm"
        variant="outline"
        leftIcon={<Download className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        Export
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label="Export your CV data"
          className="absolute right-0 z-30 mt-2 w-[340px] rounded-card border border-border bg-card p-4 shadow-lg"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-medium text-foreground">Columns</span>
              <span className="flex gap-2 text-caption">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setAll(true)}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setAll(false)}
                >
                  None
                </button>
              </span>
            </div>

            <div className="max-h-[300px] space-y-3 overflow-y-auto pr-1">
              {groups.map((g) =>
                g.ids.length > 0 ? (
                  <fieldset key={g.title}>
                    <legend className="text-byline uppercase tracking-[0.12em] text-ink-soft">
                      {g.title}
                    </legend>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {g.ids.map((id) => (
                        <label key={id} className="flex cursor-pointer items-center gap-2 text-caption text-foreground">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-current"
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
                      className="h-3.5 w-3.5 accent-current"
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
                onClick={download}
              >
                Download
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
