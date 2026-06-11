import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BrandMark } from '@/components/BrandMark';
import { SampleRecord } from '@/components/landing/SampleRecord';

export const metadata: Metadata = {
  title: 'Sample CV',
  description: 'A sample debate CV: source-backed tournament rows, breaks, speaker scores, judging, and growth signals.',
};

/**
 * The standalone sample record — same artifact as the landing page's
 * centerpiece, readable as its own document for anyone sent the link.
 */
export default function SamplePage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-5 md:py-7">
      <header className="flex items-center justify-between gap-4 border-b-2 border-record-ink pb-4">
        <Link href="/" aria-label="Debate CV home">
          <BrandMark />
        </Link>
        <Link href="/">
          <Button variant="primary" rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}>
            Build my CV
          </Button>
        </Link>
      </header>

      <main className="space-y-10 py-10 md:py-14">
        <SampleRecord />

        <footer className="border-t border-record-rule/40 pt-6">
          <p className="meta max-w-2xl">
            Every row above is fictional; every column is real. Your record stays
            private while you inspect it and fix ambiguous matches — publish a clean
            URL or export a file when another debater, society, or institution asks
            for receipts.
          </p>
        </footer>
      </main>
    </div>
  );
}
