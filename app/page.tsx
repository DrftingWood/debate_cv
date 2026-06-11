import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { auth, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Footer } from '@/components/Footer';
import { BrandMark } from '@/components/BrandMark';
import { SampleCvPreview } from '@/components/landing/SampleCvPreview';

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect('/cv');

  return (
    <>
      <div className="mx-auto max-w-6xl px-5">
        <LandingMasthead />
        <main className="space-y-20 pb-16 md:space-y-24">
          <Hero />
          <ValueStrip />
          <HowItWorks />
          <PrivacyProof />
          <Faq />
          <FinalCta />
        </main>
      </div>
      <Footer />
    </>
  );
}

async function BuildCvButton({ size = 'lg' as 'md' | 'lg' }: { size?: 'md' | 'lg' }) {
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
        Build my debate CV
      </Button>
    </form>
  );
}

function LandingMasthead() {
  return (
    <header className="flex items-center justify-between gap-4 py-5 md:py-7">
      <Link href="/" aria-label="debate cv home">
        <BrandMark />
      </Link>
      <nav className="flex items-center gap-4 text-table font-medium text-record-muted sm:gap-6">
        <Link href="/sample" className="hover:text-record-ink">Sample CV</Link>
        <a href="#privacy" className="hover:text-record-ink">Privacy</a>
        <a href="#how" className="hidden hover:text-record-ink sm:inline">How it works</a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-10 pt-8 md:grid-cols-[0.9fr_1.1fr] md:gap-12 md:pt-14">
      <div>
        <div className="eyebrow">Verified tournament record</div>
        <h1 className="mt-4 max-w-3xl font-display text-h1 font-semibold leading-[1.02] tracking-tight text-record-ink md:text-display">
          Your debate history, readable and ready to share.
        </h1>
        <p className="mt-5 max-w-xl text-body leading-relaxed text-record-muted md:text-body-serif">
          Debate CV turns tournament links you already have into a private record of
          results, breaks, speaker scores, and growth over time — source-backed rows
          you can share when it matters.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
          <BuildCvButton />
          <Link href="/sample">
            <Button type="button" size="lg" variant="outline">
              View sample CV
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid gap-2 text-caption text-record-muted sm:grid-cols-3 sm:gap-3">
          <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-record-green" aria-hidden /> read-only Gmail</span>
          <span className="inline-flex items-center gap-2"><Lock className="h-4 w-4 text-record-green" aria-hidden /> private until shared</span>
          <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-record-green" aria-hidden /> source-backed rows</span>
        </div>
      </div>

      <SampleCvPreview />
    </section>
  );
}

function ValueStrip() {
  const values = [
    {
      title: 'Know the record',
      body: 'See tournaments, teams, roles, breaks, and speaker results in one place instead of scattered inbox links.',
    },
    {
      title: 'Watch the trend',
      body: 'Spot how your scores, breaks, and activity changed across seasons — useful for reflection, not vanity.',
    },
    {
      title: 'Share proof',
      body: 'Keep it private, publish a clean link, or export a CV when another debater or institution needs receipts.',
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3" aria-label="Product value">
      {values.map((value) => (
        <article key={value.title} className="record-panel p-5">
          <h2 className="font-display text-h4 font-semibold text-record-ink">{value.title}</h2>
          <p className="mt-2 text-ui leading-relaxed text-record-muted">{value.body}</p>
        </article>
      ))}
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      label: '01',
      title: 'Connect or import',
      body: 'Start with read-only Gmail so Debate CV can find Tabbycat private URLs, then add missed links manually when needed.',
    },
    {
      label: '02',
      title: 'Claim your identity',
      body: 'Confirm which speaker or judge rows are yours. Ambiguous names stay out of your CV until you approve them.',
    },
    {
      label: '03',
      title: 'Review the record',
      body: 'Your CV becomes a structured record with source-backed tournament rows, growth signals, and share controls.',
    },
  ];

  return (
    <section id="how" className="scroll-mt-24">
      <div className="max-w-2xl">
        <div className="eyebrow">How it works</div>
        <h2 className="mt-3 font-display text-h2 font-semibold tracking-tight text-record-ink">
          From scattered links to one verified record.
        </h2>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.map((step) => (
          <article key={step.label} className="border-l-2 border-record-green pl-4">
            <div className="font-mono text-caption font-semibold text-record-green">{step.label}</div>
            <h3 className="mt-2 font-display text-h4 font-semibold text-record-ink">{step.title}</h3>
            <p className="mt-2 text-ui leading-relaxed text-record-muted">{step.body}</p>
          </article>
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
    <section id="privacy" className="scroll-mt-24 record-panel overflow-hidden">
      <div className="grid gap-6 border-b border-record-rule p-5 md:grid-cols-[0.7fr_1.3fr] md:p-6">
        <div>
          <div className="eyebrow">Privacy</div>
          <h2 className="mt-3 font-display text-h2 font-semibold tracking-tight text-record-ink">
            What is read, what is stored, how you leave.
          </h2>
        </div>
        <p className="text-body leading-relaxed text-record-muted">
          Gmail access is read-only and used for one thing: finding tournament links
          you were sent. The import is narrow; the CV stays yours.
        </p>
      </div>
      <div className="divide-y divide-record-rule">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-5 py-3 md:grid-cols-[180px_1fr] md:px-6">
            <div className="data-label">{label}</div>
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
    <section className="grid gap-8 md:grid-cols-[0.7fr_1.3fr]">
      <div>
        <div className="eyebrow">Before you connect</div>
        <h2 className="mt-3 font-display text-h2 font-semibold tracking-tight text-record-ink">
          Straight answers.
        </h2>
      </div>
      <div className="divide-y divide-record-rule border-y border-record-rule">
        {items.map((item) => (
          <details key={item.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-ui font-semibold text-record-ink">
              {item.q}
              <span className="text-record-green transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 max-w-2xl text-ui leading-relaxed text-record-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="record-panel bg-record-ink p-6 text-archive-white md:p-8">
      <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
        <div>
          <div className="eyebrow text-record-green">Start the record</div>
          <h2 className="mt-3 font-display text-h2 font-semibold tracking-tight">
            Know what you have done. Share it when it matters.
          </h2>
          <p className="mt-3 max-w-2xl text-ui leading-relaxed text-archive-white/70">
            Build a private debate CV first. Publish or export only when the record is ready.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
          <BuildCvButton />
          <Link href="/sample">
            <Button type="button" size="lg" variant="outline" className="border-archive-white/20 text-archive-white hover:bg-archive-white/10">
              View sample
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
