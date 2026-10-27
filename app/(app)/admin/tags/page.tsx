import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { AdminTagProposals } from '@/components/AdminTagProposals';
import { AdminClassifyMotionsButton } from '@/components/AdminClassifyMotionsButton';
import { AdminTagPreprocess } from '@/components/AdminTagPreprocess';
import { buttonClasses } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Tag proposals · Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminTagsPage() {
  // Same guard as /admin/page.tsx — requireAdmin throws on unauthorised;
  // we catch and redirect rather than letting the error bubble to the
  // Next.js error boundary.
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-3">
        <div className="kicker">ADMIN · TAG PROPOSALS</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">
          Tag proposals
        </h1>
        <hr className="hairline" />
        <div className="byline flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            "Suggest all tags" fills this list with an answer for every untagged motion and
            tournament. Reject the few that look wrong, then approve the rest in one click.
            Approved values are written to the canonical Tournament.region / Motion.motionType /
            Motion.topic columns and become visible on all CVs.
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <AdminTagPreprocess />
            <AdminClassifyMotionsButton />
            <Link href="/admin" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
              ← Admin
            </Link>
          </span>
        </div>
      </header>

      <AdminTagProposals />
    </div>
  );
}
