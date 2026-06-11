import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { auth, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { BrandMark } from '@/components/BrandMark';
import { Footer } from '@/components/Footer';

export default async function Home() {
  const session = await auth();
  // CV-first: signed-in users land on /cv (their tournament history).
  // /cv handles its own onboarding/empty-state redirects internally.
  if (session?.user) redirect('/cv');

  return (
    <>
      <LandingHeader />
      <div className="mx-auto max-w-6xl px-5">
        <main className="space-y-24 pb-12">
          <Hero />
          <HowItWorks />
          <Privacy />
          <Faq />
          <ClosingCta />
        </main>
      </div>
      <Footer />
    </>
  );
}

/**
 * Primary CTA: names the user outcome ("Build my debate CV"), not the
 * provider. The brief is explicit: "Consent to value, not to a provider."
 * Google sign-in is mentioned as supporting trust text below the button.
 */
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

function LandingHeader() {
  // Signed-out IA: Sample CV / How it works / Privacy / Build my CV.
  // The first three are in-page anchors on a single-pager — the user can
  // evaluate value and trust without navigating away from the artifact.
  return (
    <header className="border-b border-ink/15">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
        <Link href="/" className="inline-flex items-center" aria-label="debate cv home">
          <BrandMark />
        </Link>
        <nav
          aria-label="Primary"
          className="hidden items-center gap-6 text-table text-ink-soft sm:flex"
        >
          <a href="#sample" className="hover:text-ink">Sample CV</a>
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#privacy" className="hover:text-ink">Privacy</a>
        </nav>
        <div className="flex items-center gap-3">
          <BuildCvButton size="md" />
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="pt-12 md:pt-16">
      <div className="grid items-start gap-12 md:grid-cols-[1.05fr_0.95fr] md:gap-16">
        <div>
          <div className="kicker">FOR UNIVERSITY DEBATERS</div>

          <h1 className="mt-4 font-display text-h1 font-semibold leading-[1.04] tracking-tight text-ink md:text-display">
            Your debate history, readable and ready to share.
          </h1>

          <p className="mt-6 max-w-xl text-body-serif text-ink/85">
            Build a private, source-backed record of every tournament you have
            spoken at or judged. See tournaments, breaks, speaker scores, and
            growth over time — in one place, linked to the tab pages they came
            from.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <BuildCvButton />
          </div>

          <div className="mt-4 text-byline text-ink-soft">
            Continue with Google · read-only Gmail · private until you share it
          </div>
        </div>

        <div id="sample" className="scroll-mt-24">
          <SampleCv />
        </div>
      </div>
    </section>
  );
}

/**
 * Right-column sample CV. The product is the artifact, so the artifact has
 * to be visible above the fold. Numbers are illustrative; layout matches
 * the real /cv record header + speaking-row pattern so the user knows what
 * they are actually getting.
 */
function SampleCv() {
  return (
    <div className="surface-card p-6">
      <div className="kicker">SAMPLE · PRIVATE RECORD</div>
      <div className="mt-3 font-display text-stat font-semibold leading-tight text-ink">
        Abhishek Acharya
      </div>
      <div className="byline mt-1">IGNOU · Active 2021–2026</div>

      <hr className="hairline my-4" />

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Tournaments', value: '23' },
          { label: 'Breaks', value: '9' },
          { label: 'Best rank', value: '#3' },
          { label: 'Best avg', value: '74.2' },
        ].map((m) => (
          <div key={m.label}>
            <div className="text-kicker uppercase tracking-[0.16em] text-ink-soft">
              {m.label}
            </div>
            <div className="mt-1 font-display text-h3 font-semibold text-ink num">
              {m.value}
            </div>
          </div>
        ))}
      </div>

      <hr className="hairline my-5" />

      <ul className="space-y-3">
        {[
          { name: 'WUDC · Vietnam', meta: '2024 · Octofinalist' },
          { name: 'EUDC · Tallinn', meta: '2023 · ESL Semis' },
          { name: 'Hart House IV', meta: '2023 · Champion' },
          { name: 'ABP · Manila', meta: '2022 · Quarterfinalist' },
        ].map((row) => (
          <li key={row.name} className="flex items-baseline justify-between gap-3">
            <span className="text-body text-ink">{row.name}</span>
            <span className="num whitespace-nowrap text-byline text-ink-soft">
              {row.meta}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center gap-2 text-byline text-ink-soft">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
        Every row links to the source tab page.
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: 'Sign in',
      body: 'Continue with Google. We request read-only Gmail access, scoped to finding tournament URLs.',
    },
    {
      title: 'We find verified tournament links',
      body: 'A narrow regex matches Tabbycat private URLs in your inbox. Email bodies are not stored.',
    },
    {
      title: 'Your record appears',
      body: 'Each tournament is parsed into team, speaker, round, and break results — stitched into one personal record.',
    },
    {
      title: 'Verify, share, or export',
      body: 'Review ambiguous matches, share with a private link, or export as PDF, CSV, or XLSX.',
    },
  ];

  return (
    <section id="how" className="scroll-mt-24 space-y-8">
      <header className="max-w-2xl">
        <div className="kicker">HOW IT WORKS</div>
        <h2 className="mt-3 font-display text-h2 font-semibold tracking-tight text-ink">
          From inbox to a record you can read in one page.
        </h2>
      </header>

      <ol className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className="space-y-2">
            <div className="num text-kicker uppercase tracking-[0.16em] text-primary">
              Step {String(i + 1).padStart(2, '0')}
            </div>
            <h3 className="font-display text-h3 font-semibold text-ink">{s.title}</h3>
            <p className="text-body leading-relaxed text-ink/85">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Privacy() {
  // Privacy is a conversion requirement, not a footer obligation (brief §10).
  // Every row here states an operational fact about production behavior.
  // If any of these stops being true, update the row in the same PR.
  const rows: { label: string; body: React.ReactNode }[] = [
    {
      label: 'Scope',
      body: (
        <>
          Read-only Gmail (<code className="rounded bg-primary-soft px-1 py-0.5 font-mono text-caption text-primary">gmail.readonly</code>).
          We search for tournament URLs on{' '}
          <code className="rounded bg-primary-soft px-1 py-0.5 font-mono text-caption text-primary">calicotab.com</code>{' '}
          and{' '}
          <code className="rounded bg-primary-soft px-1 py-0.5 font-mono text-caption text-primary">herokuapp.com</code>.
        </>
      ),
    },
    {
      label: 'What we store',
      body: 'The matched URLs, the tab data parsed from them, and your CV. OAuth refresh tokens are encrypted at rest (AES-256-GCM).',
    },
    {
      label: 'What we do not store',
      body: 'Email bodies, message metadata, anything outside the matched tournament URLs.',
    },
    {
      label: 'Who can see it',
      body: 'Only you, until you share. Public links and exports are opt-in and revocable.',
    },
    {
      label: 'Disconnect or delete',
      body: (
        <>
          Settings → <Link href="/settings" className="text-primary underline-offset-2 hover:underline">Disconnect</Link>{' '}
          revokes the OAuth grant. Delete your account and everything — tokens, URLs, jobs, claims — is removed.
        </>
      ),
    },
  ];

  return (
    <section id="privacy" className="scroll-mt-24 space-y-6">
      <header className="max-w-2xl">
        <div className="kicker">PRIVACY</div>
        <h2 className="mt-3 font-display text-h2 font-semibold tracking-tight text-ink">
          Concrete, not aspirational.
        </h2>
        <p className="mt-3 text-body text-ink/80">
          We ask for sensitive permission. Here is exactly what that means in
          production — no marketing copy, no "we value your privacy" filler.
        </p>
      </header>

      <ul className="divide-y divide-ink/10 border-y border-ink/15">
        {rows.map((r) => (
          <li
            key={r.label}
            className="grid gap-3 py-4 md:grid-cols-[12rem_1fr] md:gap-8"
          >
            <div className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
              <div className="text-byline uppercase tracking-[0.14em] text-ink-soft">
                {r.label}
              </div>
            </div>
            <div className="text-body leading-relaxed text-ink/85">{r.body}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Faq() {
  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: 'Why does Google say "unverified app"?',
      a: (
        <>
          Apps requesting Gmail scopes need Google verification for broad
          public use. We are still in Google&apos;s Testing program, so only
          addresses added as Test Users can sign in. The "Advanced → Go to
          debate cv (unsafe)" prompt is the standard dev-mode notice.
        </>
      ),
    },
    {
      q: 'Is this affiliated with Tabbycat or Calico?',
      a: (
        <>
          No. debate cv is an independent tool that reads publicly accessible
          Tabbycat tournament pages linked from your own inbox. Tabbycat is
          MIT-licensed open-source software built by the wider debate
          community.
        </>
      ),
    },
    {
      q: 'What if my name is not detected on a tournament page?',
      a: (
        <>
          Some tab pages use non-standard markup our parser can&apos;t read.
          Every tournament has a roster picker so you can claim yourself
          manually — stats appear in one click.
        </>
      ),
    },
    {
      q: 'Can I delete all my data?',
      a: (
        <>
          Yes. Go to{' '}
          <Link href="/settings" className="text-primary underline-offset-2 hover:underline">
            Settings
          </Link>
          , click <strong>Delete my data</strong>, and confirm by typing your
          email. The account, tokens, URLs, jobs, and identity claims are
          removed.
        </>
      ),
    },
    {
      q: 'Is my CV public by default?',
      a: 'No. Your CV is private until you generate a share link or export it. Share links are revocable from Settings.',
    },
  ];

  return (
    <section className="space-y-6">
      <header className="max-w-2xl">
        <div className="kicker">QUESTIONS</div>
        <h2 className="mt-3 font-display text-h2 font-semibold tracking-tight text-ink">
          Common things debaters ask.
        </h2>
      </header>
      <div className="border-y border-ink/15">
        {items.map((it, i) => (
          <details
            key={i}
            className={'group px-1 py-4 ' + (i > 0 ? 'border-t border-ink/10' : '')}
          >
            <summary className="cursor-pointer list-none text-body-serif font-medium text-ink [&::-webkit-details-marker]:hidden">
              <span className="inline-flex w-full items-center justify-between gap-4">
                <span>{it.q}</span>
                <span
                  aria-hidden
                  className="select-none text-primary transition-transform duration-[180ms] ease-soft group-open:rotate-45"
                >
                  +
                </span>
              </span>
            </summary>
            <div className="mt-3 max-w-3xl text-body leading-relaxed text-ink/85">
              {it.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="border-t border-ink/15 pt-12">
      <div className="max-w-2xl space-y-5">
        <div className="kicker">START</div>
        <h2 className="font-display text-h2 font-semibold tracking-tight text-ink">
          Build your record. Keep it private. Share it on your terms.
        </h2>
        <div className="pt-2">
          <BuildCvButton />
        </div>
        <div className="text-byline text-ink-soft">
          Continue with Google · read-only Gmail · private until you share it
        </div>
      </div>
    </section>
  );
}
