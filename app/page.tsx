import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { auth, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Footer } from '@/components/Footer';

export default async function Home() {
  const session = await auth();
  // CV-first: signed-in users land on /cv (their tournament history). The
  // /cv page handles its own onboarding/empty-state redirects internally,
  // so we don't have to special-case "no claims yet" here.
  if (session?.user) redirect('/cv');

  return (
    <>
      <div className="mx-auto max-w-6xl px-5">
        <LandingMasthead />
        <div className="space-y-24">
          <Hero />
          <HowItWorks />
          <Colophon />
          <Faq />
          <Subscribe />
        </div>
      </div>
      <Footer />
    </>
  );
}

async function SignInButton({ size = 'lg' as 'md' | 'lg' }: { size?: 'md' | 'lg' }) {
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
        Sign in with Google
      </Button>
    </form>
  );
}

/**
 * Admin entry point. Same Google OAuth flow as the user sign-in — auth
 * itself doesn't differ, only the post-login destination. The /admin route
 * server-side `requireAdmin()`s against the ADMIN_EMAIL env var; non-admins
 * who click this fall through to / and re-redirect to /cv, so the
 * button is safe to expose publicly.
 */
async function AdminSignInButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signIn('google', { redirectTo: '/admin' });
      }}
    >
      <Button
        type="submit"
        size="md"
        variant="outline"
        leftIcon={<ShieldAlert className="h-3.5 w-3.5" aria-hidden />}
      >
        Admin sign-in
      </Button>
    </form>
  );
}

function LandingMasthead() {
  return (
    <header className="pt-8 pb-6">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-serif italic text-h3 tracking-tight text-ink">
          debate <span className="text-oxblood">cv</span>
        </span>
        <span className="hidden text-byline uppercase tracking-[0.22em] text-ink-soft sm:inline">
          A personal record of the parliamentary kind
        </span>
      </div>
      <hr className="hairline mt-3" />
    </header>
  );
}

function Hero() {
  return (
    <section className="relative pt-10 pb-6 md:pt-16">
      <div className="grid items-start gap-12 md:grid-cols-[1.05fr_0.95fr] md:gap-16">
        <div>
          <div className="kicker">A CAREER IN PARLIAMENTARY DEBATE</div>

          <h1 className="mt-4 font-serif text-h1 leading-[1.04] tracking-tight text-ink md:text-display">
            Your debate cv,{' '}
            <em className="font-serif italic">compiled from your inbox.</em>
          </h1>

          <div className="byline mt-5 inline-block border-b border-ink/15 pb-2">
            Vol. I  ·  Spring 2026  ·  by Google's Gmail API
          </div>

          <p className="dropcap mt-6 max-w-xl font-serif text-body-serif text-ink/85">
            Sign in with Google. We scan your inbox for the Tabbycat private
            URLs you were already sent, fetch each tournament's team, speaker,
            and break tabs, and stitch your personal history into one page. No
            essays. No drag-and-drop. Just a CV.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <SignInButton />
            <AdminSignInButton />
          </div>

          <div className="mt-4 text-byline text-ink-soft">
            read-only Gmail · private to you · delete any time
          </div>
        </div>

        <div>
          <PaperCvExcerpt />
        </div>
      </div>
    </section>
  );
}

/**
 * Right-column hero illustration: a typeset paper CV excerpt. Replaces
 * the previous glass-card screenshot pastiche. Self-referential — the
 * site shows what it produces, in the style of what it produces.
 */
function PaperCvExcerpt() {
  return (
    <div className="surface-card p-6">
      <div className="kicker">DEBATE CV — VOL. III · COMPILED 23 MAY 2026</div>
      <div className="mt-3 font-serif italic text-stat leading-tight text-ink">
        Abhishek Acharya.
      </div>
      <hr className="hairline my-3" />
      <div className="byline">IGNOU · a.acharya@example.com</div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        {[
          { label: 'Tournaments', value: '23' },
          { label: 'Breaks', value: '9' },
          { label: 'Best spkr rank', value: '#3' },
          { label: 'Best avg', value: '74.2' },
        ].map((m) => (
          <div key={m.label}>
            <div className="text-kicker text-ink-soft uppercase tracking-[0.16em]">
              {m.label}
            </div>
            <div className="mt-1 font-serif text-h3 text-ink num">{m.value}</div>
          </div>
        ))}
      </div>

      <hr className="hairline my-5" />

      <ul className="space-y-3">
        <li className="flex items-baseline justify-between gap-3">
          <span className="font-serif italic text-body text-ink">WUDC · Vietnam</span>
          <span className="text-byline text-ink-soft num">2024 · Octofinalist</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="font-serif italic text-body text-ink">EUDC · Tallinn</span>
          <span className="text-byline text-ink-soft num">2023 · ESL Semis</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="font-serif italic text-body text-ink">Hart House IV</span>
          <span className="text-byline text-ink-soft num">2023 · Champion</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="font-serif italic text-body text-ink">ABP · Manila</span>
          <span className="text-byline text-ink-soft num">2022 · Quarterfinalist</span>
        </li>
      </ul>
    </div>
  );
}

function HowItWorks() {
  const items = [
    {
      roman: 'I.',
      title: 'Connect Gmail',
      body: (
        <>
          One-click sign-in with Google. The scope is read-only{' '}
          <code className="rounded bg-oxblood-soft px-1 py-0.5 font-mono text-caption text-oxblood">
            gmail.readonly
          </code>{' '}
          — nothing else.
        </>
      ),
    },
    {
      roman: 'II.',
      title: 'We find your Tabbycat links',
      body: (
        <>
          A narrow regex matches tournament private URLs on{' '}
          <code className="rounded bg-oxblood-soft px-1 py-0.5 font-mono text-caption text-oxblood">
            calicotab.com
          </code>{' '}
          and{' '}
          <code className="rounded bg-oxblood-soft px-1 py-0.5 font-mono text-caption text-oxblood">
            herokuapp.com
          </code>
          . Email bodies are never stored.
        </>
      ),
    },
    {
      roman: 'III.',
      title: 'Your CV appears',
      body: (
        <>
          Each tournament's team, speaker, round, and break tabs are parsed
          and stitched into a clean personal history page. The queue drains
          in the background while you watch.
        </>
      ),
    },
  ];

  return (
    <section id="how" className="space-y-8">
      <header className="max-w-2xl">
        <div className="kicker">EDITOR'S NOTE · ON METHOD</div>
        <h2 className="mt-3 font-serif text-h2 italic text-ink">
          Three steps from sign-in to a complete history page.
        </h2>
      </header>

      <div className="grid gap-x-10 gap-y-8 md:grid-cols-3">
        {items.map((it) => (
          <article key={it.roman} className="space-y-3">
            <div className="font-serif italic text-h3 text-oxblood">{it.roman}</div>
            <h3 className="font-serif text-h3 italic text-ink">{it.title}</h3>
            <p className="font-serif text-body leading-relaxed text-ink/85">{it.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Colophon() {
  const points = [
    {
      label: 'Scope',
      title: 'We only read what we need',
      body:
        'The regex runs inside a narrow Gmail search. Message bodies are never stored — only the matched URLs.',
    },
    {
      label: 'Storage',
      title: 'Encrypted at rest',
      body:
        'OAuth refresh tokens are stored with AES-256-GCM, keyed from a server-only secret. No emails. No message metadata.',
    },
    {
      label: 'Revocation',
      title: 'Revoke any time',
      body: (
        <>
          Settings → <Link href="/settings" className="text-oxblood hover:underline">Disconnect</Link>{' '}
          revokes the OAuth grant. Delete your account and everything goes — tokens, URLs, jobs, claims.
        </>
      ),
    },
  ];

  return (
    <section>
      <header className="max-w-2xl">
        <div className="kicker">COLOPHON · PROCESS &amp; POLICY</div>
        <h2 className="mt-3 font-serif text-h2 italic text-ink">
          Plain English, zero surprises.
        </h2>
        <p className="mt-3 font-serif text-body-serif text-ink/80">
          During sign-in you'll see Google's "unverified app" notice — we're still in their Testing
          program. The underlying scope is read-only Gmail, same as any inbox-parsing productivity tool.
        </p>
      </header>

      <div className="mt-8 grid gap-x-10 gap-y-6 md:grid-cols-3">
        {points.map((p) => (
          <article key={p.label} className="space-y-2">
            <div className="kicker">{p.label}</div>
            <h3 className="font-serif text-h3 italic text-ink">{p.title}</h3>
            <p className="font-serif text-body leading-relaxed text-ink/85">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Faq() {
  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: 'Why does Google say "unverified app"?',
      a: (
        <>
          Apps that request Gmail scopes need Google's verification for broad public use. We're
          still in Google's Testing mode, so only addresses added as Test Users can sign in. The
          "Advanced → Go to debate cv (unsafe)" flow is the standard dev-mode prompt — expected
          and safe.
        </>
      ),
    },
    {
      q: 'Is this affiliated with Tabbycat or Calico?',
      a: (
        <>
          No. debate cv is an independent tool that reads publicly available Tabbycat tournament
          pages linked in your own inbox. Tabbycat is MIT-licensed open-source software built by
          the wider debate community.
        </>
      ),
    },
    {
      q: "What if my name isn't detected on a private URL?",
      a: (
        <>
          Some tournament pages use non-standard text that our parser can't extract. On your CV,
          every tournament has a roster picker so you can pick yourself manually — stats appear
          in one click.
        </>
      ),
    },
    {
      q: 'Can I delete all my data?',
      a: (
        <>
          Yes. Go to <Link href="/settings" className="text-oxblood hover:underline">Settings</Link>,
          click <strong>Delete my data</strong>, confirm by typing your email. The account, tokens,
          URLs, jobs, and identity claims are removed.
        </>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <header className="max-w-2xl">
        <div className="kicker">LETTERS · FREQUENTLY ASKED</div>
        <h2 className="mt-3 font-serif text-h2 italic text-ink">
          From the inbox.
        </h2>
      </header>
      <div className="border-y border-ink/15">
        {items.map((it, i) => (
          <details
            key={i}
            className={'group px-1 py-4 ' + (i > 0 ? 'border-t border-ink/10' : '')}
          >
            <summary className="cursor-pointer list-none font-serif text-body-serif text-ink [&::-webkit-details-marker]:hidden">
              <span className="inline-flex w-full items-center justify-between gap-4">
                <span>{it.q}</span>
                <span
                  aria-hidden
                  className="font-serif text-h4 text-oxblood transition-transform duration-[180ms] ease-soft group-open:rotate-180"
                >
                  ▾
                </span>
              </span>
            </summary>
            <div className="mt-3 font-serif text-body leading-relaxed text-ink/85">
              {it.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Subscribe() {
  return (
    <section>
      <hr className="hairline" />
      <div className="mt-10 max-w-2xl">
        <div className="kicker">SUBSCRIBE</div>
        <h2 className="mt-3 font-serif text-h2 italic text-ink">
          Sign in, run the scan, watch your history compile.
        </h2>
        <div className="mt-6">
          <SignInButton />
        </div>
      </div>
    </section>
  );
}
