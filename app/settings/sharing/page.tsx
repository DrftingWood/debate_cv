import { Share2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { SharingManager } from '@/components/SharingManager';

export const dynamic = 'force-dynamic';

export default function SharingSettingsPage() {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-display text-h3 font-semibold text-foreground">
            Public sharing
          </h2>
        </div>
        <SharingManager />
      </CardBody>
    </Card>
  );
}
