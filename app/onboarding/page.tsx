import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { OnboardingFlow } from '@/components/OnboardingFlow';
import { Card, CardBody } from '@/components/ui/Card';

export const metadata: Metadata = {
  title: 'Set up your CV',
  description: 'Confirm which names on your private URLs are you.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Onboarding page. Server-side decides the starting phase from data so the
 * client component can render the right step without an empty flicker.
 *
 * Brand-new users land on the three-step wizard (scan → preflight → pick).
 * Already-set-up users (≥1 claimed Person) instead see a stub pointing them
 * to the durable surfaces — Dashboard for re-scanning Gmail or chasing
 * failed URLs, Settings → Profile for adding/removing name aliases.
 * Onboarding is a one-shot wizard, not the canonical home for identity
 * management.
 */
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [urlCount, preflightRemaining, claimedCount] = await Promise.all([
    prisma.discoveredUrl.count({ where: { userId } }),
    prisma.discoveredUrl.count({
      where: { userId, registrationName: null, registrationPersonId: null },
    }),
    prisma.person.count({ where: { claimedByUserId: userId } }),
  ]);

  if (claimedCount > 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-6 md:py-10">
        <header className="space-y-2">
          <h1 className="font-display text-h2 font-semibold tracking-tight text-foreground md:text-h1">
            You&apos;re already set up
          </h1>
          <p className="text-[14px] text-muted-foreground md:text-[15px]">
            Onboarding only runs once. Use the surfaces below to manage your
            CV and identity going forward.
          </p>
        </header>

        <Card>
          <CardBody className="space-y-4 p-6">
            <div className="inline-flex items-center gap-2 text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              <span className="text-[14px] font-medium">
                {claimedCount} {claimedCount === 1 ? 'identity' : 'identities'} claimed
              </span>
            </div>
            <ul className="space-y-2 text-[14px]">
              <li className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <Link href="/cv" className="font-medium text-primary hover:underline">
                    My CV
                  </Link>{' '}
                  — view and share your tournament history.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <Link href="/dashboard" className="font-medium text-primary hover:underline">
                    Dashboard
                  </Link>{' '}
                  — re-scan Gmail, retry failed URLs, claim unmatched tournaments.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  <Link href="/settings" className="font-medium text-primary hover:underline">
                    Settings
                  </Link>{' '}
                  — add or remove name aliases under Your identities.
                </span>
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    );
  }

  const initialPhase: 'scan' | 'preflight' | 'pick' =
    urlCount === 0 ? 'scan' : preflightRemaining > 0 ? 'preflight' : 'pick';

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6 md:py-10">
      <header className="space-y-2">
        <h1 className="font-display text-h2 font-semibold tracking-tight text-foreground md:text-h1">
          Welcome — let&apos;s find you
        </h1>
        <p className="text-[14px] text-muted-foreground md:text-[15px]">
          Three quick steps and your CV is ready.
        </p>
      </header>

      <OnboardingFlow
        initialPhase={initialPhase}
        initialUrlCount={urlCount}
        initialPreflightRemaining={preflightRemaining}
      />
    </div>
  );
}
