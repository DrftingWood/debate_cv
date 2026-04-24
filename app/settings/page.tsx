import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Shield, Mail } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  DisconnectGoogleButton,
  DownloadDataButton,
  DeleteAccountButton,
} from '@/components/AccountActions';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Manage your Gmail connection, data export, and account deletion.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [user, gmailToken, counts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, image: true },
    }),
    prisma.gmailToken.findUnique({
      where: { userId },
      select: { encryptionVersion: true, updatedAt: true, scope: true },
    }),
    Promise.all([
      prisma.discoveredUrl.count({ where: { userId } }),
      prisma.ingestJob.count({ where: { userId } }),
      prisma.person.count({ where: { claimedByUserId: userId } }),
    ]).then(([urls, jobs, claimed]) => ({ urls, jobs, claimed })),
  ]);

  const tokenEncrypted = gmailToken?.encryptionVersion === 'v1';

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-1">Settings</h1>
        <p className="mt-1 text-sm text-ink-3">
          Manage your Gmail connection and your data. All actions here affect your account only.
        </p>
      </header>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-ink-3" aria-hidden />
            <h2 className="text-base font-semibold text-ink-1">Gmail connection</h2>
          </div>
          <div className="text-sm text-ink-3">
            Signed in as <span className="font-medium text-ink-2">{user?.email ?? user?.name ?? 'Unknown'}</span>.
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={gmailToken ? 'success' : 'neutral'}>
              {gmailToken ? 'Gmail connected' : 'Gmail not connected'}
            </Badge>
            <Badge variant={tokenEncrypted ? 'success' : 'warning'}>
              {tokenEncrypted ? 'Token encrypted at rest' : 'Token stored in plaintext'}
            </Badge>
            {gmailToken?.updatedAt ? (
              <span className="text-ink-4">
                Last refreshed {new Date(gmailToken.updatedAt).toLocaleDateString()}
              </span>
            ) : null}
          </div>
          <div className="pt-2">
            <DisconnectGoogleButton />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-ink-3" aria-hidden />
            <h2 className="text-base font-semibold text-ink-1">Your data</h2>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="Private URLs" value={counts.urls} />
            <Stat label="Ingest jobs" value={counts.jobs} />
            <Stat label="Claimed identities" value={counts.claimed} />
          </dl>
          <div className="pt-2">
            <DownloadDataButton />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-base font-semibold text-ink-1">Delete account</h2>
          <p className="text-sm text-ink-3">
            Removes your user record, Gmail tokens, discovered URLs, ingest jobs, and identity
            claims. Tournament rows that are shared across users stay — they're public tab data.
          </p>
          <DeleteAccountButton userEmail={user?.email ?? null} />
        </CardBody>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle p-3">
      <dt className="text-xs text-ink-4">{label}</dt>
      <dd className="text-xl font-semibold text-ink-1">{value}</dd>
    </div>
  );
}
