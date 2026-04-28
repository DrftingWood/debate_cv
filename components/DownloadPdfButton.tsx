'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Triggers the browser's print-to-PDF flow. We don't generate a PDF
 * server-side (per Q22 — Puppeteer on Vercel is awkward) — instead we
 * pair this button with a thorough @media print stylesheet (see
 * globals.css) so the printed output is a clean credentialing
 * artifact. Users save as PDF from the print dialog.
 */
export function DownloadPdfButton({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      leftIcon={<Download className="h-3.5 w-3.5" aria-hidden />}
      onClick={() => {
        if (typeof window !== 'undefined') window.print();
      }}
    >
      Download PDF
    </Button>
  );
}
