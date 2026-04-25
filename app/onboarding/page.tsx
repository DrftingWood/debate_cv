import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { OnboardingFlow } from '@/components/OnboardingFlow';

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
 * Existing users with claimed Persons normally never see this page —
 * /dashboard sends them straight through. They CAN reach it directly via
 * /onboarding to add new aliases without losing existing claims.
 */
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [urlCount, preflightRemaining] = await Promise.all([
    prisma.discoveredUrl.count({ where: { userId } }),
    prisma.discoveredUrl.count({
      where: { userId, registrationName: null, registrationPersonId: null },
    }),
  ]);

  const initialPhase: 'scan' | 'preflight' | 'pick' =
    urlCount === 0 ? 'scan' : preflightRemaining > 0 ? 'preflight' : 'pick';

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6 md:py-10">
      <header className="space-y-2">
        <h1 className="font-display text-h2 font-semibold tracking-tight text-foreground md:text-h1">
          Welcome — let's find you
        </h1>
        <p className="text-[14px] text-muted-foreground md:text-[15px]">
          Three quick steps and your CV is ready. You can come back here anytime to add
          new spellings of your name as you upload more URLs.
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
