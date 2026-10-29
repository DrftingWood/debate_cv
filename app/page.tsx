import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { buttonClasses } from '@/components/ui/Button';
import { ShieldCheck } from '@/components/ui/icons';
import { Footer } from '@/components/Footer';
import { PublicHeader } from '@/components/landing/PublicHeader';
import { AnnotatedSample } from '@/components/landing/AnnotatedSample';
import { BuildCvButton } from '@/components/landing/BuildCvButton';

/**
 * The signed-out landing page (redesign owner decision 20, design §3.1).
 * Four sections, and the sample does the selling:
 *
 *   1. a split hero: headline, "Build my debate CV" and the one trust line
 *      on one side; the annotated sample (①②③) on the other;
 *   2. privacy as a ledger: what we read, what we keep, what we never store,
 *      then the scope and Google's review status, stated as they are;
 *   3. how it works, in four steps;
 *   4. the closing call to action.
 *
 * Every privacy row is a fact the code backs: the Gmail scan stores the URL,
 * the subject line, the message id and the date of the email that held the
 * link (`DiscoveredUrl`), never its body, and the tab pages are stored as
 * fetched (`SourceDocument`). Keep the ledger and app/(app)/privacy in step.
 */
export default async function Home() {
  const session = await auth();
  if (session?.user) redirect('/cv');

  return (
    <>
      {/*
        flex-1 so the footer sits at the bottom of a short viewport instead
        of floating mid-page. The inner wrapper was a second <main> nested
        inside the root layout's — two main landmarks on one document, which
        leaves a screen reader with no unambiguous "skip to content" target.
      */}
      <div className="mx-auto w-full max-w-wide flex-1 px-5">
        <PublicHeader />
        <main id="main" className="space-y-section pb-page md:space-y-page">
          <Hero />
          <PrivacyLedger />
          <HowItWorks />
          <FinalCta />
        </main>
      </div>
      <Footer />
    </>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-group pt-panel md:grid-cols-[0.85fr_1.15fr] md:pt-group">
      <div>
        <div className="eyebrow">Verified tournament record</div>
        {/* Two lines on a 390px phone, so the sample starts above the fold
            (design §3.1). Tailwind 4 lets an explicit leading/tracking beat a
            size token's own, so the md: pair restates the display values. */}
        <h1 className="mt-tight max-w-3xl font-display text-h1 font-medium leading-[1.03] tracking-tight text-ink md:text-display md:leading-(--text-display--line-height) md:tracking-(--text-display--letter-spacing)">
          Your debate history, kept like an account
        </h1>
        <p className="mt-stack max-w-xl text-body leading-relaxed text-ink-soft">
          Every tournament, round and motion, read from the tab pages you were already sent and laid
          out as a record you can read, measure and share.
        </p>
        <div className="mt-panel flex flex-col gap-tight sm:flex-row sm:items-center">
          <BuildCvButton />
          <Link href="/sample" className={buttonClasses({ size: 'lg', variant: 'outline' })}>
            View sample CV
          </Link>
        </div>
        <p className="mt-stack inline-flex items-center gap-inline text-caption text-ink-soft">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Read-only Gmail · we keep tab links, never email bodies
        </p>
      </div>
      <AnnotatedSample />
    </section>
  );
}

/**
 * Privacy as a statement (design §3.1): three columns of facts, then the
 * scope and its review status on one line. Rows, not paragraphs.
 */
function PrivacyLedger() {
  const columns: { title: string; rows: string[] }[] = [
    {
      title: 'What we read',
      rows: [
        'Gmail, read-only, searched only for Tabbycat tab links',
        'The public tab pages those links open',
        'Your Google name, email and photo, to sign you in',
      ],
    },
    {
      title: 'What we keep',
      rows: [
        'Each tab link we found',
        'The subject line, date and message id of the email that held the link',
        'The tab pages as we fetched them, and the results read from them',
        'The names you confirm as yours',
        'A Gmail access token, encrypted (AES-256-GCM)',
      ],
    },
    {
      title: 'What we never store',
      rows: [
        'The body of any email',
        'Any email that holds no tab link',
        'Your contacts, attachments or anything else in your mail',
      ],
    },
  ];
  return (
    <section id="privacy" aria-labelledby="privacy-title" className="scroll-mt-24">
      <div className="max-w-2xl">
        <div className="eyebrow">Privacy, as a statement</div>
        <h2
          id="privacy-title"
          className="mt-tight font-display text-h2 font-medium tracking-tight text-ink"
        >
          Exactly what we read and keep
        </h2>
      </div>
      <div className="panel mt-panel overflow-hidden">
        <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
          {columns.map((c) => (
            <div key={c.title} className="p-stack md:p-panel">
              <h3 className="data-label">{c.title}</h3>
              <ul className="mt-tight divide-y divide-border">
                {c.rows.map((r) => (
                  <li key={r} className="py-inline text-ui text-ink">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="grid gap-inline border-t border-border bg-surface-2 px-stack py-tight text-caption text-ink-soft md:grid-cols-[auto_1fr] md:gap-panel md:px-panel">
          <span>
            Scope <code className="font-mono text-ink">gmail.readonly</code>
          </span>
          <span>
            Google has not reviewed the app yet: it runs in Google&rsquo;s testing mode, so only
            invited test users can sign in for now. Your CV stays private until you share it, and
            you can disconnect Gmail or delete everything from Settings.{' '}
            <Link href="/privacy" className="text-primary underline underline-offset-2">
              The full privacy notice
            </Link>
          </span>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: 'Connect',
      body: 'Read-only Gmail finds the Tabbycat links you were sent. Paste any it missed.',
    },
    {
      title: 'Claim your name',
      body: 'Confirm which names on the tabs are you. Nothing joins your record on a guess.',
    },
    {
      title: 'Review',
      body: 'Check what was read, year by year, and fix or report anything that looks wrong.',
    },
    {
      title: 'Share',
      body: 'Private until you say so. Publish a link or print a PDF when someone asks.',
    },
  ];
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-24">
      <div className="max-w-2xl">
        <div className="eyebrow">How it works</div>
        <h2
          id="how-title"
          className="mt-tight font-display text-h2 font-medium tracking-tight text-ink"
        >
          From inbox links to a record, in four steps
        </h2>
      </div>
      <ol className="mt-panel grid gap-stack sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.title} className="border-l-2 border-primary pl-stack">
            <div className="num text-caption font-medium text-primary">0{i + 1}</div>
            <h3 className="mt-inline font-display text-h4 font-medium text-ink">{step.title}</h3>
            <p className="mt-inline text-ui leading-relaxed text-ink-soft">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="panel bg-ink p-panel text-paper md:p-group">
      <div className="grid items-center gap-panel md:grid-cols-[1fr_auto]">
        <div>
          <div className="eyebrow-on-ink">Start the record</div>
          <h2 className="mt-tight font-display text-h2 font-medium tracking-tight">
            Know what you have done. Share it when it matters
          </h2>
          <p className="mt-tight max-w-2xl text-ui leading-relaxed text-paper/70">
            Build a private debate CV first. Publish or export only when the record is ready.
          </p>
        </div>
        <div className="flex flex-col gap-tight sm:flex-row md:flex-col">
          <BuildCvButton />
          <Link
            href="/sample"
            className={buttonClasses({
              size: 'lg',
              variant: 'outline',
              className: 'border-paper/20 bg-transparent text-paper hover:bg-paper/10',
            })}
          >
            View sample
          </Link>
        </div>
      </div>
    </section>
  );
}
