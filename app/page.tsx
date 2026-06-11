import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { auth, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Footer } from '@/components/Footer';
import { BrandMark } from '@/components/BrandMark';
import { SampleRecord } from '@/components/landing/SampleRecord';

/**
 * Artifact-first landing (teardown §2.3): the page IS a sample record. A
 * compact masthead and a two-line hero, then the full-fidelity sample CV —
 * the product sample is the sales argument, not decoration. Marketing copy
 * is demoted to short ruled interstitials between record sections, and the
 * privacy table sits next to the closing CTA where the trust decision
 * actually happens.
 */
export default async function Home() {
  const session = await auth();
  if (session?.user) redirect('/cv');

  return (
    <>
      <div className="mx-auto max-w-5xl px-5 pb-24 md:pb-0">
        <LandingMasthead />
        <main className="space-y-16 pb-16 md:space-y-20">
          <Hero />
          <section id="sample" className="scroll-mt-24">
            <SampleRecord />
            <p className="meta mt-4">
              Every row above is fictional; every column is real. Your record is built
              from the tournament tabs you were sent.
            </p>
          </section>
          <ValueRows />
          <HowItWorks />
          <PrivacyProof />
          <Faq />
          <ClosingCta />
        </main>
      </div>
      <Footer />
      <MobileCtaBar />
    </>
  );
}

async function BuildCvButton({ size = 'lg' as 'md' | 'lg', fullWidth = false }: { size?: 'md' | 'lg'; fullWidth?: boolean }) {
  return (
    <form
      className={fullWidth ? 'w-full' : undefined}
      action={async () => {
        'use server';
        await signIn('google', { redirectTo: '/cv' });
      }}
    >
      <Button
        type="submit"
        size={size}
        variant="primary"
        className={fullWidth ? 'w-full' : undefined}
        rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}
      >
        Build my debate CV
      </Button>
    </form>
  );
}

function LandingMasthead() {
  return (
    <header className="flex items-center justify-between gap-4 border-b-2 border-record-ink py-4 md:py-5">
      <Link href="/" aria-label="Debate CV home">
        <BrandMark />
      </Link>
      <nav className="flex items-center gap-4 font-mono text-caption font-medium uppercase tracking-[0.08em] text-record-muted sm:gap-6">
        <a href="#sample" className="hover:text-record-ink">Sample</a>
        <a href="#how" className="hover:text-record-ink">How it works</a>
        <a href="#privacy" className="hover:text-record-ink">Privacy</a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="pt-10 md:pt-14">
      <div className="eyebrow">Verified tournament records</div>
      <h1 className="display-expanded mt-4 max-w-4xl font-display text-h1 font-bold leading-[1.04] tracking-tight text-record-ink md:text-display">
        Every break, on the record.
      </h1>
      <p className="mt-5 max-w-2xl text-body leading-relaxed text-record-muted">
        Debate CV compiles your tournaments — results, speaker scores, breaks, and
        judging — into one source-backed record you can share when it matters.
        Below is the artifact, in full.
      </p>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        <BuildCvButton />
        <a href="#sample">
          <Button type="button" size="lg" variant="outline">
            Read the sample
          </Button>
        </a>
      </div>

      <p className="mt-4 font-mono text-caption text-record-muted">
        read-only Gmail · private until shared · source-backed rows
      </p>
    </section>
  );
}

function ValueRows() {
  const values = [
    {
      title: 'Know the record',
      body: 'Tournaments, teams, roles, breaks, and speaker results in one place instead of scattered inbox links.',
    },
    {
      title: 'Watch the trend',
      body: 'How your scores, breaks, and activity changed across seasons — factual and explainable, never AI-read tea leaves.',
    },
    {
      title: 'Share proof',
      body: 'Keep it private, publish a clean link, or export a file when another debater or institution needs receipts.',
    },
  ];

  return (
    <section aria-label="What the record gives you">
      <SectionHeader title="What the record gives you" />
      <div className="divide-y divide-record-rule/40">
        {values.map((value) => (
          <div key={value.title} className="grid gap-1 py-3.5 md:grid-cols-[220px_1fr] md:gap-6">
            <h3 className="font-display text-ui font-semibold text-record-ink">{value.title}</h3>
            <p className="text-ui leading-relaxed text-record-muted">{value.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      label: '01',
      title: 'Connect or import',
      body: 'Read-only Gmail finds the Tabbycat private URLs you were sent; paste any link it missed.',
    },
    {
      label: '02',
      title: 'Claim your identity',
      body: 'Confirm which speaker or judge rows are yours. Ambiguous names stay out until you approve them.',
    },
    {
      label: '03',
      title: 'Read the record',
      body: 'Source-backed tournament rows, growth signals, and share controls — private until you publish.',
    },
  ];

  return (
    <section id="how" className="scroll-mt-24">
      <SectionHeader title="How it works" />
      <div className="divide-y divide-record-rule/40">
        {steps.map((step) => (
          <div key={step.label} className="grid gap-1 py-3.5 md:grid-cols-[220px_1fr] md:gap-6">
            <h3 className="flex items-baseline gap-3 font-display text-ui font-semibold text-record-ink">
              <span className="num text-caption text-record-muted">{step.label}</span>
              {step.title}
            </h3>
            <p className="text-ui leading-relaxed text-record-muted">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PrivacyProof() {
  const rows = [
    ['Gmail scope', 'gmail.readonly — used to find tournament links you were sent.'],
    ['Stored', 'Matched private URLs, import jobs, claimed identities, and parsed tournament data.'],
    ['Not stored', 'Email bodies and unrelated message metadata.'],
    ['Visibility', 'Your CV is private unless you explicitly share or export it.'],
    ['Deletion', 'Disconnect Gmail or delete the account from settings.'],
    ['Token storage', 'OAuth tokens are encrypted at rest with AES-256-GCM; legacy rows re-encrypt on next access.'],
  ];

  return (
    <section id="privacy" className="scroll-mt-24">
      <SectionHeader title="Privacy — what is read, stored, and never touched" />
      <div className="divide-y divide-record-rule/40">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-3 md:grid-cols-[220px_1fr] md:gap-6">
            <div className="data-label pt-0.5">{label}</div>
            <div className="text-ui text-record-ink">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: 'What does it read in my Gmail?',
      a: 'Only what is needed to find tournament links: read-only access, searched for Tabbycat private URLs. Email bodies are not stored.',
    },
    {
      q: 'Who can see my CV?',
      a: 'Nobody, until you share it. The record is private by default; publish a link or export a file when you choose, and unpublish at any time.',
    },
    {
      q: 'What if a tournament is missing?',
      a: 'Paste the private URL or re-run imports. Missing and ambiguous rows are treated as review tasks, not silently added guesses.',
    },
    {
      q: 'Is this affiliated with Tabbycat or Calico?',
      a: 'No. Debate CV is independent. It reads tournament pages linked from your own imports and turns them into your personal record.',
    },
  ];

  return (
    <section aria-label="Before you connect">
      <SectionHeader title="Before you connect" />
      <div className="divide-y divide-record-rule/40">
        {items.map((item) => (
          <details key={item.q} className="group py-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-ui font-semibold text-record-ink">
              {item.q}
              <span className="font-mono text-record-muted transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 max-w-2xl text-ui leading-relaxed text-record-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="border-t-2 border-record-ink pt-8">
      <h2 className="display-expanded max-w-2xl font-display text-h2 font-bold tracking-tight text-record-ink">
        Know what you have done. Share it when it matters.
      </h2>
      <p className="mt-3 max-w-2xl text-ui leading-relaxed text-record-muted">
        Build a private debate CV first. Publish or export only when the record is ready.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <BuildCvButton />
        <p className="font-mono text-caption text-record-muted">
          read-only Gmail · private until shared
        </p>
      </div>
    </section>
  );
}

// Mobile-first conversion: the CTA travels with the thumb while the sample
// record scrolls. Hidden on desktop, where the hero CTA stays in view.
function MobileCtaBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-record-ink bg-sheet/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
      <BuildCvButton size="md" fullWidth />
    </div>
  );
}
