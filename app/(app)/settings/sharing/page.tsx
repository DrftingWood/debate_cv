import type { Metadata } from 'next';
import { Share2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { SharingManager } from '@/components/SharingManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sharing · Settings' };

export default function SharingSettingsPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="kicker">SETTINGS · SHARING</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">
          Public sharing
        </h1>
        <p className="text-body text-ink-soft">Your public link and what it shows.</p>
        <hr className="hairline" />
      </header>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-ink-soft" aria-hidden />
            <h2 className="font-display text-h3 font-medium text-ink">Public sharing</h2>
          </div>
          <SharingManager />
        </CardBody>
      </Card>
    </div>
  );
}
