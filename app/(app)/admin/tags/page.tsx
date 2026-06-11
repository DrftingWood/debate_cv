import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { AdminTagProposals } from '@/components/AdminTagProposals';
import { AdminClassifyMotionsButton } from '@/components/AdminClassifyMotionsButton';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Admin — Tag proposals',
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
        <h1 className="font-display text-h2 font-semibold text-ink">
          Tag proposals
        </h1>
        <hr className="hairline" />
        <div className="byline flex items-center justify-between gap-2">
          <span>
            Approve or reject user-proposed region and motion tags. Approved values are
            written to the canonical Tournament.region / Motion.motionType / Motion.topic
            columns and become visible on all CVs.
          </span>
          <span className="flex items-center gap-2">
            <AdminClassifyMotionsButton />
            <Link href="/admin">
              <Button variant="outline" size="sm">
                ← Admin
              </Button>
            </Link>
          </span>
        </div>
      </header>

      <AdminTagProposals />
    </div>
  );
}
