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
          <StatisticsShowcase />
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
    <header className="flex items-center justify-between gap-4 py-5 md:py-6">
      <Link href="/" aria-label="debate cv home">
        <BrandMark />
      </Link>
      <nav className="flex items-center gap-4 text-table font-medium text-ink-soft sm:gap-6">
        <Link href="/sample" className="hover:text-ink">Sample CV</Link>
        <a href="#stats" className="hidden hover:text-ink sm:inline">Statistics</a>
        <a href="#privacy" className="hover:text-ink">Privacy</a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-10 pt-8 md:grid-cols-[0.9fr_1.1fr] md:gap-12 md:pt-12">
      <div>
        <div className="eyebrow">Verified tournament record</div>
        <h1 className="mt-4 max-w-3xl font-display text-h1 font-medium leading-[1.03] tracking-tight text-ink md:text-display">
          Your debate history, kept like an account
        </h1>
        <p className="mt-5 max-w-xl text-body leading-relaxed text-ink-soft">
          Every tournament, every round, every motion — pulled from the tab pages you were
          already sent, and laid out as a record you can read, measure and share. Speaker
          scores get the context they never had: the field you were in.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
          <BuildCvButton />
          <Link href="/sample">
            <Button type="button" size="lg" variant="outline">
              View sample CV
            </Button>
          </Link>
        </div>

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
      </div>

      <SampleCvPreview />
    </section>
  );
}

function ValueStrip() {
  const values = [
    {
      title: 'Know the record',
      body: 'Tournaments, teams, seats, breaks and speaker results in one ledger instead of forty inbox links you will never open again.',
    },
    {
      title: 'Read the motion',
      body: 'Each round carries the motion released for it, so a speaker score sits next to what you were actually arguing.',
    },
    {
      title: 'Share the proof',
      body: 'Private by default. Publish a clean link or export a PDF when another debater, society or selector asks for receipts.',
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3" aria-label="Product value">
      {values.map((value) => (
        <article key={value.title} className="panel p-5">
          <h2 className="font-display text-h4 font-medium text-ink">{value.title}</h2>
          <p className="mt-2 text-ui leading-relaxed text-ink-soft">{value.body}</p>
        </article>
      ))}
    </section>
  );
}

/**
 * The statistics pitch. This is the section that justifies the product over
 * a spreadsheet, so it shows real figure shapes rather than describing them
 * — a debater should recognise the questions before reading the labels.
 */
function StatisticsShowcase() {
  const questions = [
    {
      label: 'Level',
      figure: 'Top 8%',
      body: 'Where your average placed among every speaker on the tab, tournament by tournament — not a raw number that means something different on every circuit.',
    },
    {
      label: 'Consistency',
      figure: '±2.1',
      body: 'The spread of your speeches: median, middle 50%, floor and ceiling, and how far you swing inside a single tournament.',
    },
    {
      label: 'Momentum',
      figure: '+1.4',
      body: 'What happens across a draw. Opening rounds against closing rounds, and the fitted trend per round over every tournament long enough to have one.',
    },
    {
      label: 'Seat',
      figure: 'CG −9pp',
      body: 'Win rate and speaker average from each position in the room, measured against your own baseline rather than an abstract average.',
    },
    {
      label: 'Motion',
      figure: 'THW +12pp',
      body: 'Results by motion stem and subject area, joined round by round from each tournament’s published motions.',
    },
    {
      label: 'Conversion',
      figure: '9 / 23',
      body: 'Break rate, longest winning run, outround record, and how all of it changes with the size of the field.',
    },
  ];

  return (
    <section id="stats" className="scroll-mt-24">
      <div className="max-w-2xl">
        <div className="eyebrow">Statistics</div>
        <h2 className="mt-3 font-display text-h2 font-medium tracking-tight text-ink">
          The questions you argue about after a tournament
        </h2>
        <p className="mt-3 text-body leading-relaxed text-ink-soft">
          Answered from the tab pages themselves, with the sample size attached to every
          figure. Nothing here guesses at your style or scores your personality.
        </p>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {questions.map((q) => (
          <article key={q.label} className="panel p-5">
            <div className="data-label">{q.label}</div>
            <div className="figure mt-1.5 text-figure-md text-ink">{q.figure}</div>
            <p className="mt-2.5 text-caption leading-relaxed text-ink-soft">{q.body}</p>
          </article>
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
      body: 'Read-only Gmail finds the Tabbycat private URLs you were sent. Paste any link the scan missed.',
    },
    {
      label: '02',
      title: 'Claim your identity',
      body: 'Confirm which speaker and judge rows are yours. Ambiguous names stay out of the record until you approve them.',
    },
    {
      label: '03',
      title: 'Read the record',
      body: 'Rounds, motions, scores and results become a structured ledger with statistics and share controls on top.',
    },
  ];

  return (
    <section id="how" className="scroll-mt-24">
      <div className="max-w-2xl">
        <div className="eyebrow">From links to record</div>
        <h2 className="mt-3 font-display text-h2 font-medium tracking-tight text-ink">
          The import exists to get out of your way
        </h2>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.map((step) => (
          <article key={step.label} className="border-l-2 border-primary pl-4">
            <div className="num text-caption font-medium text-primary">{step.label}</div>
            <h3 className="mt-2 font-display text-h4 font-medium text-ink">{step.title}</h3>
            <p className="mt-2 text-ui leading-relaxed text-ink-soft">{step.body}</p>
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
    <section id="privacy" className="panel scroll-mt-24 overflow-hidden">
      <div className="grid gap-6 border-b border-border p-5 md:grid-cols-[0.7fr_1.3fr] md:p-6">
        <div>
          <div className="eyebrow">Privacy before polish</div>
          <h2 className="mt-3 font-display text-h2 font-medium tracking-tight text-ink">
            The trust model, stated plainly
          </h2>
        </div>
        <p className="text-body leading-relaxed text-ink-soft">
          Debate CV asks for a sensitive permission, so the product has to say exactly what it
          reads, what it stores, and how you leave. The import is narrow; the record stays yours.
        </p>
      </div>
      <div className="divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-5 py-3 md:grid-cols-[180px_1fr] md:px-6">
            <div className="data-label">{label}</div>
            <div className="text-ui text-ink">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: 'Is this an AI tool?',
      a: 'No. The product parses tournament pages and presents structured records. It should read like a ledger, not a chatbot.',
    },
    {
      q: 'Why Gmail?',
      a: 'Many Tabbycat private URLs arrive by email. Read-only Gmail lets the importer find those links without asking you to rebuild years of tournament history by hand.',
    },
    {
      q: 'Where do the statistics come from?',
      a: 'Entirely from the public tab pages — your own rows plus every other speaker published on the same tab, which is what makes a placement percentile possible. Nothing is modelled or estimated.',
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
        <div className="eyebrow">Questions worth asking</div>
        <h2 className="mt-3 font-display text-h2 font-medium tracking-tight text-ink">
          No magic, no elite gate
        </h2>
      </div>
      <div className="divide-y divide-border border-y border-border">
        {items.map((item) => (
          <details key={item.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-ui font-medium text-ink">
              {item.q}
              <span className="text-primary transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 max-w-2xl text-ui leading-relaxed text-ink-soft">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="panel bg-ink p-6 text-paper md:p-8">
      <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
        <div>
          <div className="eyebrow text-primary">Start the record</div>
          <h2 className="mt-3 font-display text-h2 font-medium tracking-tight">
            Know what you have done. Share it when it matters
          </h2>
          <p className="mt-3 max-w-2xl text-ui leading-relaxed text-paper/70">
            Build a private debate CV first. Publish or export only when the record is ready.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
          <BuildCvButton />
          <Link href="/sample">
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="border-paper/20 bg-transparent text-paper hover:bg-paper/10"
            >
              View sample
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
