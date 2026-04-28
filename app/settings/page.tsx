import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Shield, Mail, Database, UserCheck } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  DisconnectGoogleButton,
  DownloadDataButton,
  DeleteAccountButton,
} from '@/components/AccountActions';
import { IdentityManager } from '@/components/IdentityManager';

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
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-h1 font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-2 text-body text-muted-foreground">
          Manage your Gmail connection and your data. Actions here affect your account only.
        </p>
      </header>

      {/* Gmail */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="font-display text-h3 font-semibold text-foreground">
              Gmail connection
            </h2>
          </div>
          <div className="text-[14px] text-muted-foreground">
            Signed in as{' '}
            <span className="font-medium text-foreground">
              {user?.email ?? user?.name ?? 'Unknown'}
            </span>
            .
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={gmailToken ? 'success' : 'neutral'}>
              {gmailToken ? 'Gmail connected' : 'Gmail not connected'}
            </Badge>
            <Badge variant={tokenEncrypted ? 'success' : 'warning'}>
              {tokenEncrypted ? 'Token encrypted at rest (AES-256-GCM)' : 'Token stored in plaintext'}
            </Badge>
            {gmailToken?.updatedAt ? (
              <span className="text-caption text-muted-foreground">
                Last refreshed {new Date(gmailToken.updatedAt).toLocaleDateString()}
              </span>
            ) : null}
          </div>
          <div className="pt-1">
            <DisconnectGoogleButton />
          </div>
        </CardBody>
      </Card>

      {/* Identities */}
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

      {/* Data */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="font-display text-h3 font-semibold text-foreground">Your data</h2>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-[14px]">
            <DataStat
              label="Private URLs"
              value={counts.urls}
              hint="Tabbycat private-URL links extracted from your Gmail."
            />
            <DataStat
              label="Ingest jobs"
              value={counts.jobs}
              hint="Per-URL parsing tasks. Most are 'done' once the queue drains."
            />
            <DataStat
              label="Claimed identities"
              value={counts.claimed}
              hint="Person rows on tournaments you've confirmed as you (handles name aliases)."
            />
          </dl>
          <div className="pt-1">
            <DownloadDataButton />
          </div>
        </CardBody>
      </Card>

      {/* Danger zone */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-destructive" aria-hidden />
            <h2 className="font-display text-h3 font-semibold text-foreground">Delete account</h2>
          </div>
          <p className="text-[14px] text-muted-foreground">
            Removes your user record, Gmail tokens, discovered URLs, ingest jobs, and identity
            claims. Tournament rows shared across users stay — they're public tab data.
          </p>
          <DeleteAccountButton userEmail={user?.email ?? null} />
        </CardBody>
      </Card>
    </div>
  );
}

function DataStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/50 px-3.5 py-3">
      <dt className="text-caption text-muted-foreground" title={hint}>
        {label}
      </dt>
      <dd className="mt-0.5 font-display text-[22px] font-semibold text-foreground">{value}</dd>
      {hint ? (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
