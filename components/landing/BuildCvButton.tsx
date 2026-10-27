import { ArrowRight, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { signIn } from '@/lib/auth';
import { Button } from '@/components/ui/Button';

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
      <Button
        type="submit"
        size={size}
        variant="primary"
        rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}
      >
        {label}
      </Button>
    </form>
  );
}

/** The three privacy facts a visitor weighs before granting Gmail access (§10). */
export function TrustRow() {
  return (
    <div className="mt-5 grid gap-2 text-caption text-ink-soft sm:grid-cols-3 sm:gap-3">
      <span className="inline-flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> read-only Gmail
      </span>
      <span className="inline-flex items-center gap-2">
        <Lock className="h-4 w-4 text-primary" aria-hidden /> private until shared
      </span>
      <span className="inline-flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden /> source-backed rows
      </span>
    </div>
  );
}
