import { Share2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const dynamic = 'force-dynamic';

/**
 * Placeholder until the public-CV feature lands. Kept in the side-nav so
 * users see what's coming and there's a stable URL to deep-link.
 */
export default function SharingSettingsPage() {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-display text-h3 font-semibold text-foreground">
            Public sharing
          </h2>
          <Badge variant="warning">Coming soon</Badge>
        </div>
        <p className="text-[14px] text-muted-foreground">
          You&apos;ll be able to make your CV publicly shareable via a link
          (something like <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">/u/your-slug</code>),
          opt out of showing your avatar, and pick a custom slug. The data
          shown publicly will be the same as on your CV — Tabbycat tabs are
          already public — but action affordances (report buttons, banners)
          are stripped.
        </p>
      </CardBody>
    </Card>
  );
}
