'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Upload } from 'lucide-react';
import { Button, buttonClasses } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { postJson } from '@/lib/utils/api';

type ImportResult = { filed: number; skipped: number };

/**
 * The no-API-key route to ready answers. "Download untagged" saves everything
 * that still needs a tag as one JSON file; someone (or Claude, in a session)
 * writes the answers into a second file; "Load answers" files them as pending
 * proposals in the review queue below. From there it is the usual two steps:
 * reject any that look wrong, then approve the rest in one click.
 *
 * Nothing here writes a canonical tag. It only fills the queue.
 */
export function AdminTagPreprocess() {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const onFile = async (file: File) => {
    setLoading(true);
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        toast.show({
          kind: 'error',
          title: 'Not a JSON file',
          description: 'Pick the answers file, not the export.',
        });
        return;
      }
      const res = await postJson<ImportResult>('/api/admin/tags/import', payload);
      if (!res.ok) {
        toast.show({
          kind: 'error',
          title: 'Answers rejected',
          description:
            'A value is outside the tag lists, or the file is the wrong shape. Nothing was filed.',
        });
        return;
      }
      const { filed, skipped } = res.data;
      toast.show({
        kind: 'success',
        title:
          filed === 0
            ? 'Nothing new to file'
            : `Filed ${filed} suggestion${filed === 1 ? '' : 's'}`,
        description:
          skipped > 0
            ? `${skipped} already had a tag or a suggestion, so they were left alone.`
            : 'Review the list below, reject any that look wrong, then approve the rest.',
      });
      router.refresh();
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <span className="flex items-center gap-2">
      <a
        href="/api/admin/tags/export"
        download
        className={buttonClasses({ variant: 'outline', size: 'sm' })}
      >
        <Download className="h-3.5 w-3.5" aria-hidden /> Download untagged
      </a>
      <Button
        type="button"
        size="sm"
        variant="outline"
        loading={loading}
        leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => fileInput.current?.click()}
      >
        Load answers
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
    </span>
  );
}
