import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Mail,
  Globe,
  Trophy,
  ShieldCheck,
  Lock,
  Eye,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { auth, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <div className="space-y-24">
      <Hero />
      <HowItWorks />
      <TrustPanel />
      <Faq />
      <FooterCta />
    </div>
  );
}

async function SignInWithGoogle({ size = 'lg' as 'md' | 'lg' }: { size?: 'md' | 'lg' }) {
  return (
    <form
      action={async () => {
        'use server';
        await signIn('google', { redirectTo: '/dashboard' });
      }}
    >
      <Button type="submit" size={size} variant="primary" rightIcon={<ArrowRight className="h-4 w-4" />}>
        Sign in with Google
      </Button>
    </form>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-10 pt-8 md:grid-cols-[1.1fr_0.9fr] md:gap-16 md:pt-12">
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Built for debaters
        </span>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink-1 md:text-5xl">
          Your debate CV,
          <br className="hidden sm:block" /> auto-built from your inbox.
        </h1>
        <p className="mt-5 text-lg text-ink-3">
          Sign in with Google. We scan your Gmail for Tabbycat private URLs (calicotab.com /
          herokuapp.com), fetch each tournament's team, speaker and break tabs, and compile your
          personal history into one page.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SignInWithGoogle />
          <Link
            href="#how"
            className="text-sm text-ink-3 underline-offset-4 hover:text-ink-1 hover:underline"
          >
            How it works
          </Link>
        </div>
        <p className="mt-4 text-xs text-ink-4">
          Read-only Gmail access · No emails stored · Your CV is private to you.
        </p>
      </div>
      <Card className="bg-bg-subtle p-1">
        <MockDashboard />
      </Card>
    </section>
  );
}

function MockDashboard() {
  return (
    <div className="rounded-[10px] bg-bg p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <Trophy className="h-4 w-4 text-primary-600" aria-hidden />
          WUDC 2024
          <span className="text-ink-4 font-normal">· Vietnam</span>
        </div>
        <span className="text-xs text-ink-4">Open</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
        <div>
          <dt className="text-xs text-ink-4">Team</dt>
          <dd className="font-medium text-ink-1">Quarter Lifers</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">Record</dt>
          <dd className="font-medium text-ink-1">6W – 3L</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">Speaker total</dt>
          <dd className="font-mono text-ink-1">634</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">Break</dt>
          <dd className="font-medium text-ink-1">Octofinals</dd>
        </div>
      </dl>
      <div className="mt-5 rounded-md border border-border bg-bg-subtle p-3">
        <div className="text-xs font-medium text-ink-3">Round-by-round</div>
        <div className="mt-2 grid grid-cols-9 gap-1">
          {[74, 72, 71, 73, 70, 72, 71, 70, 71].map((n, i) => (
            <div
              key={i}
              className="flex h-10 flex-col items-center justify-center rounded bg-bg"
            >
              <div className="text-[10px] text-ink-4">R{i + 1}</div>
              <div className="text-[11px] font-mono text-ink-1">{n}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const items = [
    {
      icon: <Mail className="h-5 w-5" aria-hidden />,
      title: 'Connect Gmail',
      body: (
        <>
          One-click sign-in. We ask for the minimum scope (
          <code className="font-mono text-xs">gmail.readonly</code>) — nothing else.
        </>
      ),
    },
    {
      icon: <Globe className="h-5 w-5" aria-hidden />,
      title: 'We find your Tabbycat links',
      body: (
        <>
          A precise regex matches only tournament private URLs on{' '}
          <code className="font-mono text-xs">calicotab.com</code> and{' '}
          <code className="font-mono text-xs">herokuapp.com</code>. Nothing else is read.
        </>
      ),
    },
    {
      icon: <Trophy className="h-5 w-5" aria-hidden />,
      title: 'Your CV appears',
      body: (
        <>
          Each tournament's team, speaker, round and break tabs are parsed and stitched into a
          clean personal history page.
        </>
      ),
    },
  ];

  return (
    <section id="how" className="space-y-8">
      <header className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-ink-1">How it works</h2>
        <p className="mt-2 text-ink-3">Three steps from sign-in to a complete history page.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((it, i) => (
          <Card key={i}>
            <CardBody>
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-50 text-primary-700">
                {it.icon}
              </div>
              <h3 className="mt-4 text-base font-semibold text-ink-1">
                <span className="text-ink-4">0{i + 1} · </span>
                {it.title}
              </h3>
              <p className="mt-2 text-sm text-ink-3">{it.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

function TrustPanel() {
  const points = [
    {
      icon: <Eye className="h-5 w-5" aria-hidden />,
      title: 'We only read what we need',
      body: 'The regex runs inside a narrow Gmail search. Message bodies are never stored.',
    },
    {
      icon: <Lock className="h-5 w-5" aria-hidden />,
      title: 'Your CV is private to you',
      body: 'Every server query is filtered by your user id. No public profiles.',
    },
    {
      icon: <ShieldCheck className="h-5 w-5" aria-hidden />,
      title: 'Revoke any time',
      body: (
        <>
          Disconnect via{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:underline"
          >
            Google Account permissions
          </a>
          , and request row deletion from us.
        </>
      ),
    },
  ];

  return (
    <section className="rounded-lg border border-border bg-bg-subtle p-6 md:p-8">
      <header className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-ink-1">
          What you're authorizing, in plain English
        </h2>
        <p className="mt-2 text-ink-3">
          You'll see the "unverified app" warning during sign-in — that's because we're in Google's
          testing phase. The underlying scope is read-only Gmail, same as any Gmail-parsing
          productivity tool.
        </p>
      </header>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {points.map((p, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg text-primary-700 shadow-xs">
              {p.icon}
            </div>
            <div>
              <div className="text-sm font-semibold text-ink-1">{p.title}</div>
              <div className="mt-1 text-sm text-ink-3">{p.body}</div>
            </div>
          </div>
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
          Apps that request Gmail scopes need Google's verification for public use. We're still in
          Google's Testing mode, so only email addresses added as Test Users can sign in. The
          "Advanced → Go to debate cv (unsafe)" flow is expected and safe — it's the standard
          dev-mode prompt for any Google OAuth app.
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
      q: 'What if my name isn\'t detected on a private URL?',
      a: (
        <>
          Some tournament pages use non-standard text that our parser can't extract. On your CV,
          every tournament has a roster picker so you can pick yourself manually — and your stats
          appear in one click.
        </>
      ),
    },
    {
      q: 'Can I delete all my data?',
      a: (
        <>
          Yes. Disconnect the app in your{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-600 hover:underline"
          >
            Google Account
          </a>
          , then open a GitHub issue asking for database deletion.
        </>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <header className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-ink-1">Frequently asked</h2>
      </header>
      <div className="divide-y divide-border rounded-lg border border-border bg-bg">
        {items.map((it, i) => (
          <details key={i} className="group px-5 py-4">
            <summary className="cursor-pointer list-none font-medium text-ink-1 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex w-full items-center justify-between gap-4">
                <span>{it.q}</span>
                <span
                  aria-hidden
                  className="text-ink-4 transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </span>
            </summary>
            <div className="mt-2 text-sm text-ink-3">{it.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

function FooterCta() {
  return (
    <section className="rounded-lg border border-border bg-ink-1 px-6 py-10 text-center text-white md:px-10 md:py-14">
      <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
        Build your debate CV in a minute.
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm text-white/70">
        Connect Gmail once, run the scan, and watch your tournament history appear as the queue
        drains.
      </p>
      <div className="mt-6 inline-flex">
        <SignInWithGoogle />
      </div>
    </section>
  );
}
