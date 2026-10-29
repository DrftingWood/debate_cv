import { ArrowRight } from '@/components/ui/icons';
import { signIn } from '@/lib/auth';
import { PendingSubmit } from '@/components/PendingSubmit';

/**
 * The sign-in form behind every "Build my CV" button on the signed-out pages
 * (landing hero, landing final CTA, /sample). A plain link to "/" used to
 * send a sample visitor back to the landing page instead of into Google
 * sign-in (audit COPY-5).
 */
export async function BuildCvButton({
  size = 'lg',
  label = 'Build my debate CV',
}: {
  size?: 'md' | 'lg';
  label?: string;
}) {
  return (
    <form
      action={async () => {
        'use server';
        await signIn('google', { redirectTo: '/cv' });
      }}
    >
      <PendingSubmit
        size={size}
        variant="primary"
        rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}
      >
        {label}
      </PendingSubmit>
    </form>
  );
}
