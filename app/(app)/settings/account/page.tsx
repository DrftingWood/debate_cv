import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Database, Envelope, Shield } from '@/components/ui/icons';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { syncGmailTokenFromAccount } from '@/lib/gmail/client';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  DisconnectGoogleButton,
  DownloadDataButton,
  DeleteAccountButton,
} from '@/components/AccountActions';
import { ReconnectGmailButton } from '@/components/ReconnectGmailButton';
import { formatDate } from '@/lib/utils/date';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Account · Settings' };

const gmailTokenSelect = {
  encryptionVersion: true,
  updatedAt: true,
  scope: true,
} as const;

export default async function AccountSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [user, initialGmailToken, counts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, image: true },
    }),
    prisma.gmailToken.findUnique({ where: { userId }, select: gmailTokenSelect }),
    Promise.all([
      prisma.discoveredUrl.count({ where: { userId } }),
      prisma.ingestJob.count({ where: { userId } }),
      prisma.person.count({ where: { claimedByUserId: userId } }),
    ]).then(([urls, jobs, claimed]) => ({ urls, jobs, claimed })),
  ]);

  // Self-healing: if no GmailToken but the Google Account row still has
  // OAuth tokens, rebuild GmailToken from Account. See the long comment
  // on syncGmailTokenFromAccount for why we don't trust events.signIn
  // alone on NextAuth v5 beta.
  const gmailToken =
    initialGmailToken ??
    ((await syncGmailTokenFromAccount(userId))
      ? await prisma.gmailToken.findUnique({ where: { userId }, select: gmailTokenSelect })
      : null);

  const tokenEncrypted = gmailToken?.encryptionVersion === 'v1';

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="kicker">SETTINGS · ACCOUNT</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">Account</h1>
        <hr className="hairline" />
      </header>

      {/* Gmail */}
      <Card>
        <CardBody className="pt-5 space-y-4">
          <div className="flex items-center gap-2">
            <Envelope className="h-4 w-4 text-ink-soft" aria-hidden />
            <h2 className="font-display text-h3 font-medium text-ink">Gmail connection</h2>
          </div>
          <div className="text-body text-ink-soft">
            Signed in as{' '}
            <span className="font-medium text-ink">{user?.email ?? user?.name ?? 'Unknown'}</span>.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={gmailToken ? 'success' : 'neutral'}>
              {gmailToken ? 'Gmail connected' : 'Gmail not connected'}
            </Badge>
            {gmailToken ? (
              <Badge variant={tokenEncrypted ? 'success' : 'warning'}>
                {tokenEncrypted
                  ? 'Token encrypted at rest (AES-256-GCM)'
                  : 'Token stored in plaintext'}
              </Badge>
            ) : null}
            {gmailToken?.updatedAt ? (
              <span className="text-caption text-ink-soft">
                Last refreshed {formatDate(gmailToken.updatedAt)}
              </span>
            ) : null}
          </div>
          <div className="pt-1">
            {gmailToken ? (
              <DisconnectGoogleButton />
            ) : (
              <ReconnectGmailButton redirectTo="/settings/account" label="Reconnect Gmail" />
            )}
          </div>
        </CardBody>
      </Card>

      {/* Data */}
      <Card>
        <CardBody className="pt-5 space-y-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-ink-soft" aria-hidden />
            <h2 className="font-display text-h3 font-medium text-ink">Your data</h2>
          </div>
          <dl className="grid grid-cols-1 gap-3 text-ui sm:grid-cols-3">
            <DataStat label="Tournament links" value={counts.urls} />
            <DataStat label="Imports" value={counts.jobs} />
            <DataStat label="Names you claimed" value={counts.claimed} />
          </dl>
          <div className="pt-1">
            <DownloadDataButton />
          </div>
        </CardBody>
      </Card>

      {/* Danger zone */}
      <Card>
        <CardBody className="pt-5 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-destructive" aria-hidden />
            <h2 className="font-display text-h3 font-medium text-ink">Delete account</h2>
          </div>
          <p className="text-body text-ink-soft">
            Removes your account, Gmail connection, links, imports and claimed names. Public tab
            results stay.
          </p>
          <DeleteAccountButton userEmail={user?.email ?? null} />
        </CardBody>
      </Card>
    </div>
  );
}

function DataStat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-paper px-3.5 py-3">
      <dt className="text-caption text-ink-soft">{label}</dt>
      <dd className="figure mt-0.5 text-stat text-ink">{value}</dd>
      {/* A second <dd>, not a <div>: a dl group may hold only dt and dd
          (axe definition-list, SET-15). */}
      {hint ? <dd className="mt-1 text-byline leading-snug text-ink-soft">{hint}</dd> : null}
    </div>
  );
}
