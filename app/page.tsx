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
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { auth, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <div className="space-y-28">
      <Hero />
      <HowItWorks />
      <TrustStrip />
      <TrustPanel />
      <Faq />
      <FooterCta />
    </div>
  );
}

async function SignInButton({ size = 'lg' as 'md' | 'lg' }: { size?: 'md' | 'lg' }) {
  return (
    <form
      action={async () => {
        'use server';
        await signIn('google', { redirectTo: '/dashboard' });
      }}
    >
      <Button
        type="submit"
        size={size}
        variant="primary"
        rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}
        className="shadow-glow"
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
 * who click this fall through to / and re-redirect to /dashboard, so the
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

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 -top-20 h-[620px] bg-gradient-hero"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 -top-20 h-[620px] hero-texture opacity-60"
      />

      <div className="relative grid items-center gap-12 pt-10 pb-4 md:grid-cols-[1.05fr_0.95fr] md:gap-16 md:pt-16">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary-soft px-3 py-1 text-caption font-medium text-accent-foreground">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Built for debaters
          </span>

          <h1 className="mt-5 text-h1 md:text-display font-hero font-medium tracking-tight text-foreground">
            Your debate CV,
            <br className="hidden sm:block" /> auto-built from your inbox.
          </h1>

          <p className="mt-5 max-w-xl text-body text-muted-foreground">
            Sign in with Google. We scan your Gmail for Tabbycat private URLs
            (calicotab.com / herokuapp.com), fetch each tournament's team, speaker and
            break tabs, and compile your personal history into one page.
          </p>

          <div
            className="mt-8 flex flex-wrap items-center gap-3 animate-fade-up"
            style={{ animationDelay: '80ms' }}
          >
            <SignInButton />
            <AdminSignInButton />
            <Link
              href="#how"
              className="text-[14px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              How it works
            </Link>
          </div>

          <div
            className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-muted-foreground animate-fade-in"
            style={{ animationDelay: '160ms' }}
          >
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
              Read-only Gmail
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
              Private to you
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
              Delete any time
            </span>
          </div>
        </div>

        <div
          className="animate-fade-up"
          style={{ animationDelay: '120ms' }}
        >
          <GlassCvPreview />
        </div>
      </div>
    </section>
  );
}

function GlassCvPreview() {
  return (
    <div className="glass-card rounded-card p-1.5">
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 px-3 pt-1 pb-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[hsl(0_70%_65%)]" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[hsl(40_80%_60%)]" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[hsl(135_50%_55%)]" aria-hidden />
        <span className="ml-3 text-caption text-muted-foreground">debate-cv.app / cv</span>
      </div>

      <div className="grid gap-3 rounded-[calc(var(--radius-card)-4px)] bg-card p-4 md:grid-cols-[140px_1fr]">
        {/* Profile rail */}
        <div className="flex flex-col items-center gap-3 rounded-card bg-gradient-to-b from-primary-soft to-card p-4 md:items-start">
          <div className="relative inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-accent text-white shadow-sm">
            <span className="font-display text-[17px] font-semibold">AA</span>
          </div>
          <div className="text-center md:text-left">
            <div className="font-display text-[15px] font-semibold text-foreground">
              Abhishek Acharya
            </div>
            <div className="text-caption text-muted-foreground">IGNOU · speaker</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-primary/20 bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
              5 tournaments
            </span>
            <span className="rounded-full border border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.12)] px-2 py-0.5 text-[11px] font-medium text-success">
              2 breaks
            </span>
          </div>
        </div>

        {/* Timeline excerpt */}
        <div className="space-y-3">
          <div className="rounded-card border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-[14px] font-semibold text-foreground">
                  WUDC 2024 · Vietnam
                </div>
                <div className="mt-0.5 text-caption text-muted-foreground">
                  Team: Quarter Lifers
                </div>
              </div>
              <span className="rounded-full border border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.12)] px-2 py-0.5 text-[11px] font-medium text-success">
                Octos
              </span>
            </div>
            <div className="mt-3 grid grid-cols-9 gap-1">
              {[74, 72, 71, 73, 70, 72, 71, 70, 71].map((n, i) => (
                <div
                  key={i}
                  className="flex h-9 flex-col items-center justify-center rounded-md bg-muted/70"
                >
                  <div className="text-[9px] text-muted-foreground">R{i + 1}</div>
                  <div className="font-mono text-[10.5px] text-foreground">{n}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-card border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-[14px] font-semibold text-foreground">
                  ILNU RR 2026
                </div>
                <div className="mt-0.5 text-caption text-muted-foreground">
                  Team: Viral Adidas Jacket Owners
                </div>
              </div>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Prelims
              </span>
            </div>
          </div>
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
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
            gmail.readonly
          </code>
          ) — nothing else.
        </>
      ),
    },
    {
      icon: <Globe className="h-5 w-5" aria-hidden />,
      title: 'We find your Tabbycat links',
      body: (
        <>
          A precise regex matches only tournament private URLs on{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">calicotab.com</code>{' '}
          and{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">herokuapp.com</code>.
        </>
      ),
    },
    {
      icon: <Trophy className="h-5 w-5" aria-hidden />,
      title: 'Your CV appears',
      body: (
        <>
          Each tournament's team, speaker, round, and break tabs are parsed and stitched into
          a clean personal history page.
        </>
      ),
    },
  ];

  return (
    <section id="how" className="space-y-10">
      <header className="max-w-2xl">
        <span className="text-caption font-semibold uppercase tracking-widest text-accent-foreground">
          How it works
        </span>
        <h2 className="mt-2 font-display text-h2 font-semibold tracking-tight text-foreground">
          Three steps from sign-in to a complete history page.
        </h2>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {items.map((it, i) => (
          <Card
            key={i}
            className="transition-all duration-[180ms] ease-soft hover:-translate-y-0.5 hover:shadow-md"
          >
            <CardBody>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-soft text-primary">
                {it.icon}
              </div>
              <h3 className="mt-5 font-display text-h3 font-semibold text-foreground">
                <span className="text-muted-foreground/70">0{i + 1} · </span>
                {it.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{it.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    'Read-only Gmail scope',
    'No emails stored',
    'AES-256 token encryption',
    'Disconnect any time',
    'Open source',
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-full border border-border bg-card px-5 py-3 text-caption text-muted-foreground shadow-xs">
      {items.map((label, i) => (
        <span key={label} className="inline-flex items-center gap-4">
          <span>{label}</span>
          {i < items.length - 1 ? (
            <span aria-hidden className="h-1 w-1 rounded-full bg-muted-foreground/40" />
          ) : null}
        </span>
      ))}
    </div>
  );
}

function TrustPanel() {
  const points = [
    {
      icon: <Eye className="h-5 w-5" aria-hidden />,
      title: 'We only read what we need',
      body: "The regex runs inside a narrow Gmail search. Message bodies are never stored.",
    },
    {
      icon: <Lock className="h-5 w-5" aria-hidden />,
      title: 'Encrypted at rest',
      body: 'OAuth refresh tokens are stored with AES-256-GCM, keyed from a server-only secret.',
    },
    {
      icon: <ShieldCheck className="h-5 w-5" aria-hidden />,
      title: 'Revoke any time',
      body: (
        <>
          Go to <Link href="/settings" className="text-primary hover:underline">Settings → Disconnect</Link>{' '}
          (revokes the OAuth grant) or delete your account with one click.
        </>
      ),
    },
  ];

  return (
    <section className="rounded-card border border-border bg-card p-6 shadow-sm md:p-10">
      <header className="max-w-2xl">
        <span className="text-caption font-semibold uppercase tracking-widest text-accent-foreground">
          What you're authorizing
        </span>
        <h2 className="mt-2 font-display text-h2 font-semibold tracking-tight text-foreground">
          Plain English, zero surprises.
        </h2>
        <p className="mt-3 text-body text-muted-foreground">
          During sign-in you'll see Google's "unverified app" notice — that's because we're still
          in testing. The underlying scope is read-only Gmail, same as any Gmail-parsing
          productivity tool.
        </p>
      </header>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {points.map((p, i) => (
          <div key={i} className="flex items-start gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary shadow-xs">
              {p.icon}
            </div>
            <div>
              <div className="font-display text-[15px] font-semibold text-foreground">
                {p.title}
              </div>
              <div className="mt-1 text-[14px] text-muted-foreground">{p.body}</div>
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
          Apps that request Gmail scopes need Google's verification for broad public use. We're
          still in Google's Testing mode, so only addresses you add as Test Users can sign in.
          The "Advanced → Go to debate cv (unsafe)" flow is expected and safe — it's the standard
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
          Yes. Go to <Link href="/settings" className="text-primary hover:underline">Settings</Link>,
          click <strong>Delete my data</strong>, confirm by typing your email. The account, tokens,
          URLs, jobs, and identity claims are removed.
        </>
      ),
    },
  ];

  return (
    <section className="space-y-6">
      <header className="max-w-2xl">
        <span className="text-caption font-semibold uppercase tracking-widest text-accent-foreground">
          FAQ
        </span>
        <h2 className="mt-2 font-display text-h2 font-semibold tracking-tight text-foreground">
          Frequently asked.
        </h2>
      </header>
      <div className="divide-y divide-border rounded-card border border-border bg-card shadow-xs">
        {items.map((it, i) => (
          <details key={i} className="group px-5 py-4">
            <summary className="cursor-pointer list-none text-[15px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <span className="inline-flex w-full items-center justify-between gap-4">
                <span>{it.q}</span>
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-transform duration-[180ms] ease-soft group-open:rotate-180"
                >
                  ▾
                </span>
              </span>
            </summary>
            <div className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{it.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

function FooterCta() {
  return (
    <section className="relative overflow-hidden rounded-card bg-gradient-ink px-6 py-12 text-center text-white md:px-12 md:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(60% 120% at 50% 0%, hsl(243 75% 59% / 0.45), transparent 70%)',
        }}
      />
      <div className="relative">
        <h2 className="font-hero text-h2 font-medium tracking-tight md:text-h1">
          Build your debate CV in a minute.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[14.5px] text-white/70">
          Connect Gmail once, run the scan, and watch your tournament history appear as the
          queue drains.
        </p>
        <div className="mt-7 inline-flex">
          <SignInButton />
        </div>
      </div>
    </section>
  );
}
