import { UserCheck } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { IdentityManager } from '@/components/IdentityManager';

export const dynamic = 'force-dynamic';

export default function ProfileSettingsPage() {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-display text-h3 font-semibold text-foreground">
            Your identities
          </h2>
        </div>
        <IdentityManager />
      </CardBody>
    </Card>
  );
}
