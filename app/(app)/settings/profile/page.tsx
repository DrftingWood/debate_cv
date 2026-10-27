import type { Metadata } from 'next';
import { UserCheck } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { IdentityManager } from '@/components/IdentityManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Profile · Settings' };

export default function ProfileSettingsPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="kicker">SETTINGS · PROFILE</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">
          Profile
        </h1>
        <p className="text-body text-ink-soft">What we know about you, and which names are yours.</p>
        <hr className="hairline" />
      </header>

      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-ink-soft" aria-hidden />
            <h2 className="font-display text-h3 font-medium text-ink">Your identities</h2>
          </div>
          <IdentityManager />
        </CardBody>
      </Card>
    </div>
  );
}
