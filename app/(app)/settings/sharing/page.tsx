import { Share2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { SharingManager } from '@/components/SharingManager';

export const dynamic = 'force-dynamic';

export default function SharingSettingsPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="eyebrow">SETTINGS · SHARING</div>
        <h1 className="font-display text-h2 text-record-ink">
          Your public link.
        </h1>
        <hr className="hairline" />
      </header>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-record-muted" aria-hidden />
            <h2 className="font-display text-h3 text-record-ink">
              Public sharing
            </h2>
          </div>
          <SharingManager />
        </CardBody>
      </Card>
    </div>
  );
}
