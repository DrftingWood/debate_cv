# Editorial Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the editorial-redesign design contract from `docs/superpowers/specs/2026-05-23-editorial-redesign-design.md` across Landing (`/`), `/cv`, and `/u/<slug>`, including the small structural refactor that extracts the global app header into a `(app)` route group.

**Architecture:** Token-level CSS variables in `app/globals.css` and Tailwind aliases in `tailwind.config.ts` change first (foundation), then the route-group refactor (structure), then shared UI primitives (Button, Badge, BrandMark, Footer, NavLink, etc.), then per-surface redesigns (Landing → /cv → /u/<slug>). Behaviour, data, and computations are preserved on every surface; only presentation changes (with one architectural exception: the route-group split).

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript 5.7 (strict) · Tailwind 3.4 · Fraunces / Inter / Plus Jakarta Sans (already wired) · Vitest 2 (used only for the one new helper). No new dependencies are added.

**Verification approach:** Each visual task is verified by `npm run typecheck`, `npm run lint`, and a manual dev-server check (`npm run dev`) of the page that changed. The one new logic helper (`volumeRoman`) gets a vitest case (new logic ≠ retroactive testing — see project CLAUDE.md "Out of scope" notes).

**Commit cadence:** One commit per task. Commit messages follow the project's existing style (`refactor:`, `feat:`, `chore:`, plus a one-line summary; Co-Authored-By trailer if available, but the trailer is optional — match what the user wants).

---

## Phase 1 — Foundation (tokens + Tailwind)

### Task 1: Update CSS variables and component utilities in `app/globals.css`

Replace the indigo-on-cool-gray palette with paper-and-ink editorial values. Retire the gradient and glow tokens. Add new editorial utility classes (`.kicker`, `.byline`, `.num`, `.dropcap`, `.pull-quote`, `.hairline`). Preserve the entire `@media print` block verbatim.

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace the `:root` block (lines 5–57)**

Open `app/globals.css`. Replace the entire `@layer base { :root { ... } ` block (the variable definitions from `--background` through `--gradient-glass`) with this version. Keep the `html`, `body`, `::selection`, `:focus-visible`, and `.skip-link` rules underneath it exactly as they are.

```css
@layer base {
  :root {
    /* Editorial paper-and-ink palette (replaces indigo SaaS) */
    --background: 38 32% 96%;          /* paper cream */
    --foreground: 220 14% 11%;         /* deep ink */
    --muted-foreground: 220 9% 40%;    /* ink-soft */
    --border: 220 14% 11%;             /* used at low opacity for hairline rules */

    --card: 0 0% 100%;
    --card-foreground: 220 14% 11%;

    --popover: 0 0% 100%;
    --popover-foreground: 220 14% 11%;

    --primary: 358 52% 32%;            /* oxblood */
    --primary-foreground: 38 32% 96%;  /* paper on oxblood */
    --primary-hover: 358 52% 26%;      /* deeper oxblood */
    --primary-soft: 358 52% 32%;       /* used at /0.08 for accent backgrounds */

    --secondary: 220 14% 96%;
    --secondary-foreground: 220 14% 11%;

    --muted: 220 16% 95%;

    --accent: 38 32% 90%;              /* slightly darker paper for inset */
    --accent-foreground: 358 52% 32%;

    --success: 138 60% 28%;
    --success-foreground: 0 0% 100%;

    --warning: 35 65% 38%;
    --warning-foreground: 0 0% 100%;

    --destructive: 0 55% 42%;
    --destructive-foreground: 0 0% 100%;

    --input: 220 14% 11%;              /* used with /0.12 for input borders */
    --ring: 358 52% 32%;               /* focus ring oxblood */

    --radius: 0.5rem;
    --radius-card: 0.625rem;

    --shadow-xs: 0 1px 2px 0 hsl(220 14% 11% / 0.04);
    --shadow-sm: 0 1px 2px hsl(220 14% 11% / 0.04), 0 1px 3px hsl(220 14% 11% / 0.04);
    --shadow-md: 0 4px 12px -2px hsl(220 14% 11% / 0.06), 0 2px 4px -1px hsl(220 14% 11% / 0.04);
    --shadow-lg: 0 12px 32px -8px hsl(220 14% 11% / 0.10), 0 4px 12px -2px hsl(220 14% 11% / 0.05);
    --shadow-xl: 0 24px 56px -16px hsl(220 14% 11% / 0.14), 0 8px 24px -4px hsl(220 14% 11% / 0.06);
    /* --shadow-glow retired (was used by the indigo primary button glow) */
    /* --gradient-hero / --gradient-ink / --gradient-accent / --gradient-glass retired */
  }
```

Notes:
- Keep `html { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }`, `body { ... }`, `::selection`, `:focus-visible`, `.skip-link` exactly as they are. They reference `var(--background)` / `var(--foreground)` / `var(--ring)` etc., which now resolve to the new editorial values automatically.
- The `font-feature-settings: 'ss01', 'cv11';` line on `body` stays — it activates Inter's stylistic alternates.

- [ ] **Step 2: Replace the `@layer components` block (lines 96–127)**

Replace the entire `@layer components { ... }` block (the one containing `.surface-card`, `.surface-elevated`, `.glass-card`, `.hero-texture`, `.font-hero`) with this version:

```css
@layer components {
  /* Surface tiers (drop shadows for on-surface elements; hairline borders instead) */
  .surface-card {
    @apply rounded-card border bg-card;
    border-color: hsl(var(--border) / 0.14);
  }
  .surface-elevated {
    @apply rounded-card border bg-card shadow-md;
    border-color: hsl(var(--border) / 0.14);
  }

  /* Editorial signatures */
  .kicker {
    font-family: var(--font-display);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: hsl(var(--primary));
  }
  .byline {
    font-family: var(--font-sans);
    font-size: 11.5px;
    color: hsl(var(--muted-foreground));
    letter-spacing: 0.04em;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .dropcap::first-letter {
    font-family: var(--font-serif);
    font-size: 40px;
    font-weight: 600;
    color: hsl(var(--primary));
    float: left;
    line-height: 0.9;
    padding: 4px 6px 0 0;
  }
  .pull-quote {
    border-left: 2px solid hsl(var(--primary));
    padding-left: 14px;
    font-family: var(--font-serif);
    font-style: italic;
    color: hsl(var(--foreground));
  }
  .hairline {
    height: 1px;
    background: hsl(var(--border) / 0.14);
    border: 0;
  }

  /* Serif display helper (preserved — used by Fraunces hero headlines) */
  .font-hero {
    font-family: var(--font-serif);
    font-feature-settings: 'ss01';
  }
}
```

The `.glass-card` and `.hero-texture` utilities are deliberately removed — they're replaced surface-by-surface in later tasks.

- [ ] **Step 3: Confirm the `@media print` block (lines 144–193) is untouched**

Scroll past the components layer and confirm the `@media print { ... }` block is exactly as it was. Don't change it. The existing print stylesheet already matches the editorial direction.

- [ ] **Step 4: Run typecheck and lint**

Run:
```bash
npm run typecheck
npm run lint
```

Expected: both clean (CSS changes don't affect TS/ESLint, but this catches accidental breakage if you nudged something).

- [ ] **Step 5: Visual smoke check**

Run `npm run dev`. Visit `http://localhost:3000`. Expected behaviour:
- The page renders without console errors.
- Background is now warm cream instead of pale blue-gray.
- Text is deep ink instead of near-black-blue.
- Indigo buttons / accents have been replaced with oxblood (red-brown).
- The landing page glass card preview will look broken (we removed `.glass-card`) — this is expected; Task 9 replaces it.

Don't worry about cosmetic issues yet. Only flag console errors or completely missing styles.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "feat(design): editorial paper-and-ink palette + utility classes"
```

---

### Task 2: Add editorial Tailwind aliases and type scale; retire gradient/glow tokens

Add semantic aliases (`paper`, `ink`, `ink.soft`, `rule`, `oxblood`, `oxblood.soft`) for clarity in JSX. Update the type scale (`kicker`, `byline`, `body-serif`; bump `display` to 64px). Retire `backgroundImage` gradients and `boxShadow.glow`. Existing classes (`text-foreground`, `bg-card`, etc.) continue to work — these are additive aliases.

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Replace the `colors` block (lines 13–57)**

Find the `extend.colors` object. Replace it with this version. The existing semantic tokens (`border`, `primary`, etc.) stay; the additions are `paper`, `ink`, `rule`, `oxblood`.

```ts
colors: {
  border: 'hsl(var(--border) / 0.14)',  // hairline default
  input: 'hsl(var(--input) / 0.20)',
  ring: 'hsl(var(--ring))',
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  primary: {
    DEFAULT: 'hsl(var(--primary))',
    foreground: 'hsl(var(--primary-foreground))',
    hover: 'hsl(var(--primary-hover))',
    soft: 'hsl(var(--primary-soft) / 0.08)',
  },
  secondary: {
    DEFAULT: 'hsl(var(--secondary))',
    foreground: 'hsl(var(--secondary-foreground))',
  },
  muted: {
    DEFAULT: 'hsl(var(--muted))',
    foreground: 'hsl(var(--muted-foreground))',
  },
  accent: {
    DEFAULT: 'hsl(var(--accent))',
    foreground: 'hsl(var(--accent-foreground))',
  },
  success: {
    DEFAULT: 'hsl(var(--success))',
    foreground: 'hsl(var(--success-foreground))',
  },
  warning: {
    DEFAULT: 'hsl(var(--warning))',
    foreground: 'hsl(var(--warning-foreground))',
  },
  destructive: {
    DEFAULT: 'hsl(var(--destructive))',
    foreground: 'hsl(var(--destructive-foreground))',
  },
  popover: {
    DEFAULT: 'hsl(var(--popover))',
    foreground: 'hsl(var(--popover-foreground))',
  },
  card: {
    DEFAULT: 'hsl(var(--card))',
    foreground: 'hsl(var(--card-foreground))',
  },

  // Editorial aliases — self-documenting in JSX
  paper: 'hsl(var(--background))',
  ink: {
    DEFAULT: 'hsl(var(--foreground))',
    soft: 'hsl(var(--muted-foreground))',
  },
  rule: 'hsl(var(--border) / 0.14)',
  oxblood: {
    DEFAULT: 'hsl(var(--primary))',
    soft: 'hsl(var(--primary-soft) / 0.08)',
  },
},
```

Note: `border` is now bound to the low-opacity rule by default. The few places that need a stronger border (e.g. focused inputs) can override with explicit `border-foreground/30` or use `border-ink`.

- [ ] **Step 2: Update the `fontSize` block (lines 63–70)**

Replace the existing `fontSize` block with:

```ts
fontSize: {
  kicker: ['10.5px', { lineHeight: '1.2', letterSpacing: '0.2em', fontWeight: '600' }],
  byline: ['11.5px', { lineHeight: '1.4', letterSpacing: '0.04em' }],
  caption: ['12.5px', { lineHeight: '1.4', letterSpacing: '0.01em' }],
  body: ['15px', { lineHeight: '1.6' }],
  'body-serif': ['16.5px', { lineHeight: '1.55' }],
  h4: ['18px', { lineHeight: '1.3', letterSpacing: '-0.005em' }],
  h3: ['22px', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
  h2: ['36px', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
  h1: ['48px', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
  display: ['64px', { lineHeight: '1.02', letterSpacing: '-0.025em' }],
},
```

Note the added `h4` entry — `CvHighlights.tsx` already uses `text-h4` and we need to keep that working. The existing config didn't have it (it relied on Tailwind's default `text-xl` for h4); we make it explicit.

- [ ] **Step 3: Retire `backgroundImage` gradients and `boxShadow.glow`**

Find the `backgroundImage` block (lines 85–90) and replace with an empty object (we'll remove the key entirely if Tailwind warns; an empty object is safest):

```ts
// backgroundImage: {} — gradients retired in the editorial pass.
```

Just delete the `backgroundImage:` key and its braces from the `extend` object.

Find the `boxShadow` block (lines 77–84) and remove only the `glow` entry. Keep `xs` / `sm` / `md` / `lg` / `xl`:

```ts
boxShadow: {
  xs: 'var(--shadow-xs)',
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  xl: 'var(--shadow-xl)',
  // glow retired
},
```

- [ ] **Step 4: Run typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: typecheck passes. Lint may flag some unused class names down the road; we fix those in their owning task, not here.

- [ ] **Step 5: Identify remaining gradient/glow usages (informational — fixed by later tasks)**

Run:
```bash
npm run dev
```

The dev server should compile. Expect TypeScript / Tailwind to keep compiling even though some classes that referenced the gradients (e.g. `bg-gradient-hero`, `shadow-glow`) are now no-ops. Specific files that need fixing in later tasks:
- `app/page.tsx` — `bg-gradient-hero`, `hero-texture`, `glass-card`, `bg-gradient-accent`, `bg-gradient-ink`, `shadow-glow`
- `app/cv/page.tsx` — `bg-gradient-hero`, `hero-texture`, `bg-gradient-accent`
- `app/u/[slug]/page.tsx` — `bg-gradient-accent`
- `components/BrandMark.tsx` — `bg-gradient-accent`

You don't fix these in this task. They get fixed when their owning page/component is redesigned in later tasks.

- [ ] **Step 6: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat(design): editorial Tailwind aliases + type scale; retire gradients"
```

---

## Phase 2 — Structural refactor (route group)

### Task 3: Create `app/(app)/layout.tsx` and move app routes into the route group

Extract the sticky header + global footer out of `app/layout.tsx` and into a new `app/(app)/layout.tsx`. Move every existing app route under the `(app)` group. The public CV at `/u/<slug>` stays where it is and inherits *only* the root layout, so global nav doesn't leak into the public artifact.

**Files:**
- Create: `app/(app)/layout.tsx`
- Modify: `app/layout.tsx`
- Move (folder relocations — same content, new path):
  - `app/cv/` → `app/(app)/cv/`
  - `app/dashboard/` → `app/(app)/dashboard/`
  - `app/settings/` → `app/(app)/settings/`
  - `app/onboarding/` → `app/(app)/onboarding/`
  - `app/admin/` → `app/(app)/admin/`
  - `app/privacy/` → `app/(app)/privacy/`
  - `app/terms/` → `app/(app)/terms/`
- Stays in place: `app/page.tsx` (landing — needs its own bespoke masthead per spec; gets only the root layout), `app/u/[slug]/`, `app/api/`, `app/layout.tsx`

- [ ] **Step 1: Create `app/(app)/layout.tsx` with the sticky header + footer**

Create `app/(app)/layout.tsx` with the following content. This is the existing sticky header + main wrapper + global footer, lifted from `app/layout.tsx`.

```tsx
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { NavLink } from '@/components/NavLink';
import { BrandMark } from '@/components/BrandMark';
import { Footer } from '@/components/Footer';
import { NotificationBell } from '@/components/NotificationBell';

/**
 * (app) route group layout — applies to the entire app surface:
 * landing, /cv, /dashboard, /settings, /onboarding, /admin, /privacy,
 * /terms. Holds the sticky header (BrandMark + nav + notifications)
 * and the global footer.
 *
 * The public CV at /u/<slug> deliberately lives OUTSIDE this group so
 * it doesn't inherit any app chrome — the public surface reads as a
 * standalone document.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Logo target depends on auth: signed-in users go to their CV (the
  // primary in-app surface), signed-out users land on the marketing home.
  const session = await auth();
  const logoHref = session?.user?.id ? '/cv' : '/';

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href={logoHref} className="inline-flex items-center">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-6 text-[13.5px] font-medium">
              <NavLink href="/cv">My CV</NavLink>
              <NavLink href="/dashboard">Dashboard</NavLink>
              <NavLink href="/settings">Settings</NavLink>
            </nav>
            {session?.user?.id ? <NotificationBell /> : null}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10">{children}</div>
      <Footer />
    </>
  );
}
```

- [ ] **Step 2: Shrink `app/layout.tsx` to root concerns only**

Replace the entire contents of `app/layout.tsx` with this. It keeps fonts, metadata, ToastProvider, skip-link, and the `<main>` wrapper — but removes the header and footer (those moved to `(app)/layout.tsx`).

```tsx
import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans, Fraunces } from 'next/font/google';
import { cn } from '@/lib/utils/cn';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const fontDisplay = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});
const fontSerif = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
  display: 'swap',
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://debate-cv.vercel.app');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'debate cv — your debate tournament history, from your inbox',
    template: '%s · debate cv',
  },
  description:
    'Sign in with Google and we build your debate tournament CV from the Tabbycat private URLs in your Gmail. Speaker scores, break results, team mates — all in one place.',
  applicationName: 'debate cv',
  authors: [{ name: 'DrftingWood', url: 'https://github.com/DrftingWood' }],
  openGraph: {
    title: 'debate cv',
    description: 'Your debate tournament history, compiled from your Gmail.',
    type: 'website',
    siteName: 'debate cv',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'debate cv',
    description: 'Your debate tournament history, compiled from your Gmail.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF6EC' },
    { media: '(prefers-color-scheme: dark)', color: '#181A1F' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(fontSans.variable, fontDisplay.variable, fontSerif.variable)}
    >
      <body className="min-h-screen flex flex-col font-sans antialiased">
        <ToastProvider>
          <a href="#main" className="skip-link">Skip to content</a>
          <main id="main" className="flex-1">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
```

Note: `themeColor` HSL values updated to the new paper/ink swatch. `auth()` import removed from this file — it now lives in `(app)/layout.tsx` where the nav uses it.

- [ ] **Step 3: Move signed-in app routes into the `(app)` group**

Run these moves. They are pure filesystem operations — no file contents change. **Landing (`app/page.tsx`) deliberately stays at the root** — it gets its own bespoke editorial masthead in Task 7 instead of the global app header.

On Windows PowerShell:

```powershell
mkdir app\(app)
git mv app\cv app\(app)\cv
git mv app\dashboard app\(app)\dashboard
git mv app\settings app\(app)\settings
git mv app\onboarding app\(app)\onboarding
git mv app\admin app\(app)\admin
git mv app\privacy app\(app)\privacy
git mv app\terms app\(app)\terms
```

If you're on Bash:
```bash
mkdir -p 'app/(app)'
git mv app/cv 'app/(app)/cv'
git mv app/dashboard 'app/(app)/dashboard'
git mv app/settings 'app/(app)/settings'
git mv app/onboarding 'app/(app)/onboarding'
git mv app/admin 'app/(app)/admin'
git mv app/privacy 'app/(app)/privacy'
git mv app/terms 'app/(app)/terms'
```

Note: `app/page.tsx` (landing), `app/api/`, `app/u/`, `app/layout.tsx`, `app/globals.css` are NOT moved.

- [ ] **Step 4: Verify the dev server compiles**

Run:
```bash
npm run dev
```

Expected:
- Dev server starts without errors.
- `http://localhost:3000` (landing) renders, signed out, **with no sticky header** (landing is now outside the `(app)` group; it'll get its own in-page masthead in Task 7).
- `http://localhost:3000/cv` redirects to onboarding if needed, or shows the existing /cv (still using old surface designs — those are fixed in later tasks). Has the sticky header.
- `http://localhost:3000/u/<any-public-slug>` — verify the sticky header is **also gone** on this route. This is the public-CV architectural win.
- `http://localhost:3000/dashboard`, `/settings`, etc. — still have the header.

If the route group breaks anything, the most likely cause is a path-alias issue inside a moved file. The `@/*` alias is repo-rooted (verify in `tsconfig.json` and `vitest.config.ts`), so imports inside the moved files should resolve unchanged.

- [ ] **Step 5: Run full typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: clean.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: full vitest suite passes. The route-group move is a filesystem-only change; tests should be unaffected.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "refactor: extract sticky header into (app) route group

The public CV at /u/<slug> previously inherited the global nav from
app/layout.tsx, leaking app chrome into the public artifact. This
moves header + footer into a new app/(app)/layout.tsx so /u/<slug>
reads as a standalone document while every other route still gets
the sticky header.

No behavioural changes; filesystem move + layout split only."
```

---

## Phase 3 — Shared components

### Task 4: Restyle `BrandMark.tsx`, `Footer.tsx`, `NavLink.tsx`

Three small brand-identity updates: BrandMark loses the gradient monogram tile and gains a Fraunces-italic wordmark; Footer becomes a paper colophon with hairline rule; NavLink uses an oxblood underline for the active marker (already does — verify the underline still resolves correctly with the new `--primary`).

**Files:**
- Modify: `components/BrandMark.tsx`
- Modify: `components/Footer.tsx`
- Modify: `components/NavLink.tsx`

- [ ] **Step 1: Replace `components/BrandMark.tsx`**

```tsx
import { cn } from '@/lib/utils/cn';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1', className)}>
      <span className="font-serif italic text-[18px] font-medium tracking-tight text-ink">
        debate
      </span>
      <span className="font-serif italic text-[18px] font-medium tracking-tight text-oxblood">
        cv
      </span>
    </span>
  );
}
```

The gradient `DC` monogram tile is removed (it relied on `bg-gradient-accent`, retired in Task 2). The wordmark is now "debate cv" in Fraunces italic, with the `cv` half in oxblood — a tiny editorial flourish that uses the brand colour once per render.

- [ ] **Step 2: Replace `components/Footer.tsx`**

```tsx
import Link from 'next/link';
import { BrandMark } from './BrandMark';

export function Footer() {
  return (
    <footer className="mt-24">
      <div className="mx-auto max-w-6xl px-5">
        <hr className="hairline" />
        <div className="flex flex-col gap-4 py-8 text-[13px] text-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark />
            <span className="hidden font-serif italic text-ink-soft sm:inline">
              · a personal record of the parliamentary kind
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <a
              href="https://github.com/DrftingWood/debate_cv"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink"
            >
              GitHub
            </a>
            <span className="text-ink-soft/70">© {new Date().getFullYear()}</span>
          </nav>
        </div>
      </div>
    </footer>
  );
}
```

The previous `border-t border-border bg-card` becomes a `.hairline` element inside the container, and the dividing line is the only structural mark — the footer sits on paper, not on an inset card. The tagline text gains italic Fraunces flavour.

- [ ] **Step 3: Update `components/NavLink.tsx` — change the active underline**

The current NavLink uses `bg-primary` for the underline, which now resolves to oxblood automatically. But the underline position (`-bottom-[14px]`) was tuned for the old sticky header padding. Replace the file with:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export function NavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== '/' && pathname?.startsWith(href));
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative rounded px-0.5 py-1 transition-colors duration-[180ms] ease-soft',
        isActive ? 'text-ink' : 'text-ink-soft hover:text-ink',
        className,
      )}
    >
      {children}
      {isActive ? (
        <span
          aria-hidden
          className="absolute -bottom-[12px] left-0 right-0 h-[2px] bg-oxblood"
        />
      ) : null}
    </Link>
  );
}
```

Changes: `text-foreground` → `text-ink`, `text-muted-foreground` → `text-ink-soft`, `bg-primary` → `bg-oxblood`. The underline lost its `rounded-full` (sober editorial doesn't use rounded underline pills).

- [ ] **Step 4: Run typecheck and lint**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 5: Visual check**

`npm run dev`. Open the dashboard or settings (any signed-in route). The sticky header now shows the new italic wordmark with oxblood "cv". The active nav item is underlined in oxblood. The footer at the bottom of pages shows the hairline rule + italic tagline.

- [ ] **Step 6: Commit**

```bash
git add components/BrandMark.tsx components/Footer.tsx components/NavLink.tsx
git commit -m "feat(design): editorial brand mark, footer colophon, nav underline"
```

---

### Task 5: Reduce and remap `Button.tsx` variants

Map the existing six-variant Button to the editorial three-variant system: `primary` becomes filled-ink (was filled-oxblood-with-glow), `secondary` becomes outlined-ink, `outline` stays as-is but loses the muted hover, `ghost` keeps quiet hover, `danger` stays for destructive actions in Settings, `link` stays. The `shadow-glow` reference is already removed (Task 2 retired the token); we sweep the className.

**Files:**
- Modify: `components/ui/Button.tsx`

- [ ] **Step 1: Replace the `variants` block in `components/ui/Button.tsx`**

Find the `const variants: Record<Variant, string> = { ... }` block (lines 14–26) and replace it with:

```tsx
const variants: Record<Variant, string> = {
  primary:
    'bg-ink text-paper hover:bg-ink/90 active:bg-ink',
  secondary:
    'bg-paper text-ink border border-ink/15 hover:border-ink/30',
  outline:
    'bg-transparent text-ink border border-ink/15 hover:bg-ink/[0.04]',
  ghost: 'bg-transparent text-ink hover:bg-ink/[0.04]',
  danger:
    'bg-destructive text-destructive-foreground hover:brightness-110',
  link:
    'text-oxblood hover:text-oxblood/80 underline-offset-4 hover:underline p-0 h-auto',
};
```

Removals:
- `shadow-sm`, `shadow-xs` removed from on-button surfaces (paper-on-paper, no shadows).
- `hover:-translate-y-[1px] active:translate-y-0` removed from primary (the floating-on-hover effect is generic SaaS).
- `bg-primary text-primary-foreground hover:bg-primary-hover` replaced with `bg-ink text-paper` (filled-ink, sober editorial).
- `text-primary hover:text-primary-hover` on link → `text-oxblood hover:text-oxblood/80` (semantically identical; clearer intent).

The button still supports `<Button variant="primary" leftIcon={...}>` from any caller; only the rendered chrome changes.

- [ ] **Step 2: Sweep the existing `shadow-glow` usage**

Run:
```bash
git grep -n "shadow-glow"
```

Expected matches will be in `app/page.tsx` (landing) — leave those for now; the landing redesign in Task 9 deletes those occurrences.

- [ ] **Step 3: Run typecheck and lint**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 4: Visual check**

`npm run dev`. Visit `/settings`. The "Sign out" button should now render filled-ink (deep ink background, paper text). Hover should darken slightly. The "Disconnect" button (variant=outline) renders outlined-ink. The "Delete my data" button (variant=danger) renders destructive red, unchanged in semantic.

- [ ] **Step 5: Commit**

```bash
git add components/ui/Button.tsx
git commit -m "feat(design): editorial Button variants (filled-ink, outlined-ink, ghost)"
```

---

### Task 6: Add `quiet` variant to `Badge.tsx`; restyle `Card.tsx`, `EmptyState.tsx`, `StatusPill.tsx`

Badges on the redesigned surfaces (/cv, /u/<slug>) shift from coloured pills to small-caps text labels. Add a new `quiet` variant that renders without a pill background and use it from the redesigned surfaces. The existing `success`/`warning`/`info`/`outline`/`neutral` variants stay — dashboard / settings / admin keep coloured pills.

**Files:**
- Modify: `components/ui/Badge.tsx`
- Modify: `components/ui/Card.tsx`
- Modify: `components/ui/EmptyState.tsx`
- Modify: `components/ui/StatusPill.tsx`

- [ ] **Step 1: Update `components/ui/Badge.tsx`**

Replace the file with:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'outline' | 'quiet';

const variants: Record<Variant, string> = {
  neutral: 'bg-muted text-ink-soft border-border',
  success: 'bg-[hsl(var(--success)/0.12)] text-success border-[hsl(var(--success)/0.22)]',
  warning: 'bg-[hsl(var(--warning)/0.12)] text-warning border-[hsl(var(--warning)/0.22)]',
  danger: 'bg-[hsl(var(--destructive)/0.10)] text-destructive border-[hsl(var(--destructive)/0.22)]',
  info: 'bg-oxblood-soft text-oxblood border-oxblood/20',
  outline: 'bg-transparent text-ink border-border',
  // Quiet: small-caps text label, no pill background. Used on /cv and
  // /u/<slug> where traffic-light pills clash with sober editorial type.
  quiet: 'bg-transparent text-ink-soft border-transparent uppercase tracking-[0.16em] text-[10.5px] font-semibold px-0 py-0',
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

export function Badge({ className, variant = 'neutral', ...rest }: BadgeProps) {
  const isQuiet = variant === 'quiet';
  return (
    <span
      className={cn(
        isQuiet
          ? 'inline-flex items-center gap-1'
          : 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption font-medium',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
```

The `info` variant changes `bg-primary-soft` → `bg-oxblood-soft` (semantically identical now that `primary` *is* oxblood, but clearer to read).

- [ ] **Step 2: Update `components/ui/Card.tsx`**

Replace the file with:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn('rounded-card border bg-card', className)}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: DivProps) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...rest} />;
}

export function CardBody({ className, ...rest }: DivProps) {
  return <div className={cn('px-5 pb-5', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        'px-5 py-3 border-t bg-muted/30 rounded-b-card',
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-h3 font-serif italic text-ink', className)}
      {...rest}
    />
  );
}

export function CardDescription({
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('mt-0.5 text-[13.5px] text-ink-soft', className)} {...rest} />
  );
}
```

Three changes from the original:
- `Card` drops `shadow-sm` (the `border` resolves to a hairline via Task 2's token re-binding).
- `CardTitle` switches from `font-display font-semibold text-foreground` to `font-serif italic text-ink` — editorial section heads instead of geometric sans.
- `CardDescription`'s `text-muted-foreground` becomes the explicit alias `text-ink-soft`.

`CardFooter` keeps `bg-muted/30` (lightly inset for visual separation from a footer button row). `border-border` references are dropped — Tailwind's default `border` utility now picks up the hairline opacity from Task 2's re-binding.

- [ ] **Step 3: Update `components/ui/EmptyState.tsx`**

Replace the file with:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center rounded-card border border-dashed border-ink/15 bg-paper px-6 py-12',
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-oxblood-soft text-oxblood">
          {icon}
        </div>
      ) : null}
      <h3 className="font-serif text-h3 italic text-ink">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md font-serif text-[14.5px] leading-relaxed text-ink-soft">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
```

Changes: dashed border becomes a faint ink rule; the icon halo shifts from `primary-soft / text-primary` to the more explicit `oxblood-soft / text-oxblood`; title font shifts to italic Fraunces; description gains serif font and `text-ink-soft`.

- [ ] **Step 4: Update `components/ui/StatusPill.tsx`**

Replace the file with:

```tsx
import * as React from 'react';
import { CheckCircle2, Clock, XCircle, Loader2, Ban, UserSearch } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type Status =
  | 'done'
  | 'pending'
  | 'running'
  | 'failed'
  | 'unavailable'
  | 'unmatched';

// Per-status colour tokens — used only for the icon and an optional
// underline. The label itself is small-caps ink, the same across all
// statuses, so the pill reads sober rather than traffic-light.
const tones: Record<Status, string> = {
  done: 'text-success',
  pending: 'text-warning',
  running: 'text-oxblood',
  failed: 'text-destructive',
  unavailable: 'text-ink-soft',
  unmatched: 'text-warning',
};

const icons: Record<Status, React.ComponentType<{ className?: string }>> = {
  done: CheckCircle2,
  pending: Clock,
  running: Loader2,
  failed: XCircle,
  unavailable: Ban,
  unmatched: UserSearch,
};

const labels: Record<Status, string> = {
  done: 'Done',
  pending: 'Pending',
  running: 'Running',
  failed: 'Failed',
  unavailable: 'Unavailable',
  unmatched: 'Unmatched',
};

export function StatusPill({
  status,
  className,
  label,
}: {
  status: Status;
  className?: string;
  label?: string;
}) {
  const Icon = icons[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 uppercase tracking-[0.14em] text-[10.5px] font-semibold text-ink-soft',
        className,
      )}
    >
      <Icon
        className={cn('h-3.5 w-3.5', tones[status], status === 'running' && 'animate-spin')}
        aria-hidden
      />
      {label ?? labels[status]}
    </span>
  );
}
```

The pill loses its rounded-full coloured background. Status colour now lives only on the icon; the label reads as a sober small-caps text marker. Semantic API (`status` enum, optional `label` override) is preserved — every caller continues to work.

- [ ] **Step 5: Run typecheck and lint**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 6: Visual check**

`npm run dev`. Visit `/dashboard`. The ingest status pills and other badges should still render (with their existing semantic colours, just on the new paper background). The dashboard isn't being editorial-restyled this pass, so don't worry about layout — only confirm no crashes.

- [ ] **Step 7: Commit**

```bash
git add components/ui/Badge.tsx components/ui/Card.tsx components/ui/EmptyState.tsx components/ui/StatusPill.tsx
git commit -m "feat(design): editorial UI primitives — quiet Badge, paper Card, serif EmptyState"
```

---

## Phase 4 — Landing redesign

### Task 7: Landing — add bespoke masthead + Footer; replace `Hero` with the editorial Feature section

Two changes wrapped into one task because landing now lives outside the `(app)` group (no inherited header/footer):

1. Add a top-of-page `<LandingMasthead>` (per spec section "I · Masthead") with the italic Fraunces wordmark, small-caps tagline, and the page's signature hairline rule.
2. Render `<Footer />` explicitly at the bottom of the page (landing no longer inherits it from `(app)/layout.tsx`).
3. Replace the existing `Hero()` function with the editorial Feature section (per spec "II · Feature"): kicker + italic Fraunces headline + byline rule + lede + actions on the left; a typeset paper CV excerpt on the right (replacing `GlassCvPreview`).

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Import `Footer` and update `Home()`'s JSX wrapper**

At the top of `app/page.tsx`, add the import:

```tsx
import { Footer } from '@/components/Footer';
```

In the `Home()` function, the current JSX is:

```tsx
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
```

(Task 9/10 will rename HowItWorks → still HowItWorks; remove TrustStrip/TrustPanel; replace FooterCta with Subscribe.)

Replace with:

```tsx
return (
  <>
    <LandingMasthead />
    <div className="space-y-24">
      <Hero />
      <HowItWorks />
      <TrustStrip />
      <TrustPanel />
      <Faq />
      <FooterCta />
    </div>
    <Footer />
  </>
);
```

Tasks 8–10 will swap `TrustStrip`/`TrustPanel` for `Colophon` and `FooterCta` for `Subscribe`. For now this leaves the section list intact while we land the masthead + Hero.

- [ ] **Step 2: Add the `LandingMasthead` component to `app/page.tsx`**

Below the `Home()` function (or wherever the file's helper components live), add:

```tsx
function LandingMasthead() {
  return (
    <header className="pt-8 pb-6">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-serif italic text-[22px] tracking-tight text-ink">
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
```

The masthead occupies the top of every landing render. It's a bespoke wordmark (Fraunces italic, oxblood `cv`), a tagline in small caps, and the site's signature hairline rule. The `<BrandMark>` component is deliberately not used here — that one's reserved for the `(app)` sticky header on signed-in routes.

- [ ] **Step 3: Replace the `Hero()` function**

In `app/page.tsx`, locate the `function Hero() { ... }` definition (currently around lines 86–160) and replace it with this:

```tsx
function Hero() {
  return (
    <section className="relative pt-10 pb-6 md:pt-16">
      <div className="grid items-start gap-12 md:grid-cols-[1.05fr_0.95fr] md:gap-16">
        <div>
          <div className="kicker">A CAREER IN PARLIAMENTARY DEBATE</div>

          <h1 className="mt-4 font-serif text-[44px] leading-[1.04] tracking-tight text-ink md:text-display">
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
```

- [ ] **Step 2: Delete the `GlassCvPreview` function and replace with `PaperCvExcerpt`**

Delete the entire `function GlassCvPreview() { ... }` block (currently lines 162–243). Add a new `PaperCvExcerpt` in its place:

```tsx
/**
 * Right-column hero illustration: a typeset paper CV excerpt. Replaces
 * the previous glass-card screenshot pastiche. Self-referential — the
 * site shows what it produces, in the style of what it produces.
 */
function PaperCvExcerpt() {
  return (
    <div className="surface-card p-6">
      <div className="kicker">DEBATE CV — VOL. III · COMPILED 23 MAY 2026</div>
      <div className="mt-3 font-serif italic text-[28px] leading-tight text-ink">
        Abhishek Acharya.
      </div>
      <hr className="hairline my-3" />
      <div className="byline">IGNOU · acharya.abhishek04@gmail.com</div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        {[
          { label: 'Tournaments', value: '23' },
          { label: 'Breaks', value: '9' },
          { label: 'Best spkr rank', value: '#3' },
          { label: 'Best avg', value: '74.2' },
        ].map((m) => (
          <div key={m.label}>
            <div className="text-byline text-ink-soft uppercase tracking-[0.16em] text-[10px]">
              {m.label}
            </div>
            <div className="mt-1 font-serif text-[22px] text-ink num">{m.value}</div>
          </div>
        ))}
      </div>

      <hr className="hairline my-5" />

      <ul className="space-y-3">
        <li className="flex items-baseline justify-between gap-3">
          <span className="font-serif italic text-[15px] text-ink">WUDC · Vietnam</span>
          <span className="text-byline text-ink-soft num">2024 · Octofinalist</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="font-serif italic text-[15px] text-ink">EUDC · Tallinn</span>
          <span className="text-byline text-ink-soft num">2023 · ESL Semis</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="font-serif italic text-[15px] text-ink">Hart House IV</span>
          <span className="text-byline text-ink-soft num">2023 · Champion</span>
        </li>
        <li className="flex items-baseline justify-between gap-3">
          <span className="font-serif italic text-[15px] text-ink">ABP · Manila</span>
          <span className="text-byline text-ink-soft num">2022 · Quarterfinalist</span>
        </li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Update `SignInButton` to drop `shadow-glow`**

In the `SignInButton` server function (currently around line 38), remove the `className="shadow-glow"` prop from the `<Button>` element:

```tsx
// Before:
<Button
  type="submit"
  size={size}
  variant="primary"
  rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}
  className="shadow-glow"
>
  Sign in with Google
</Button>

// After:
<Button
  type="submit"
  size={size}
  variant="primary"
  rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}
>
  Sign in with Google
</Button>
```

The button now uses `bg-ink text-paper` from Task 5. Sober, no glow.

- [ ] **Step 4: Delete unused imports**

At the top of `app/page.tsx`, several Lucide icons are no longer used by the new Hero (`Sparkles`, `CheckCircle2`, `ShieldAlert` for AdminSignInButton stays). Sweep and remove. Run:

```bash
npm run lint
```

ESLint will flag any unused imports. Remove them.

- [ ] **Step 5: Visual check**

`npm run dev`. Visit `http://localhost:3000` signed out. The new hero should render:
- Kicker (small caps, oxblood) above the headline.
- Two-line italic Fraunces headline, second clause italic.
- Hairline byline.
- Lede with a drop cap (large oxblood "S").
- Sign-in + Admin buttons.
- Right column: typeset paper CV excerpt with the 4 stat columns and 4 tournament rows.

If the headline overflows on a narrow viewport, that's expected — verify it wraps reasonably at 390px width.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): editorial hero — italic Fraunces, kicker, paper CV excerpt"
```

---

### Task 8: Replace landing "HowItWorks" with "Editor's Note"

The three-step explainer keeps the same three steps (Connect Gmail, Find links, CV appears) but re-cast as editorial blocks with Roman numerals + italic Fraunces sub-heads + sober copy.

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace the `HowItWorks()` function**

Find `function HowItWorks() { ... }` in `app/page.tsx` (currently around lines 245–316). Replace with:

```tsx
function HowItWorks() {
  const items = [
    {
      roman: 'I.',
      title: 'Connect Gmail',
      body: (
        <>
          One-click sign-in with Google. The scope is read-only{' '}
          <code className="rounded bg-oxblood-soft px-1 py-0.5 font-mono text-[12px] text-oxblood">
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
          <code className="rounded bg-oxblood-soft px-1 py-0.5 font-mono text-[12px] text-oxblood">
            calicotab.com
          </code>{' '}
          and{' '}
          <code className="rounded bg-oxblood-soft px-1 py-0.5 font-mono text-[12px] text-oxblood">
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
            <div className="font-serif italic text-[22px] text-oxblood">{it.roman}</div>
            <h3 className="font-serif text-h3 italic text-ink">{it.title}</h3>
            <p className="font-serif text-[15px] leading-relaxed text-ink/85">{it.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
```

The previous `<Card>` wrapper with hover lift is gone. Each step sits on paper, separated by column gaps and a single space-y rhythm.

- [ ] **Step 2: Delete the Lucide icons used only by the old HowItWorks**

The previous version imported `Mail`, `Globe`, `Trophy` for the step icons. The new version uses Roman numerals instead. Sweep these from the import block if they aren't used elsewhere in the file. Run:

```bash
npm run lint
```

Remove unused.

- [ ] **Step 3: Visual check**

`npm run dev`. Scroll to the "Editor's Note" section. Expected:
- Small-caps oxblood kicker.
- Italic Fraunces section headline.
- Three columns, each with a large italic oxblood Roman numeral, italic title, and serif body.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): replace HowItWorks with editorial Editor's Note"
```

---

### Task 9: Merge `TrustStrip` + `TrustPanel` into a single `Colophon` section

The two trust sections today say overlapping things. They merge into one editorial colophon: three columns (Scope / Storage / Revocation) on paper, no pill-strip.

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Delete the existing `TrustStrip()` and `TrustPanel()` functions**

Remove both functions entirely (currently lines 318–396). Also remove their invocations from `Home()`'s JSX (currently `<TrustStrip />` and `<TrustPanel />`).

- [ ] **Step 2: Add the new `Colophon()` function**

Insert in place of the deleted code:

```tsx
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
            <p className="font-serif text-[15px] leading-relaxed text-ink/85">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Update `Home()` to call `<Colophon />` instead of `<TrustStrip /> <TrustPanel />`**

In the `Home()` function (top of file), the JSX currently looks like:

```tsx
<div className="space-y-28">
  <Hero />
  <HowItWorks />
  <TrustStrip />
  <TrustPanel />
  <Faq />
  <FooterCta />
</div>
```

Change to:

```tsx
<div className="space-y-24">
  <Hero />
  <HowItWorks />
  <Colophon />
  <Faq />
  <FooterCta />
</div>
```

(`space-y-28` → `space-y-24` — slightly tighter rhythm, since each section is now visually quieter.)

- [ ] **Step 4: Sweep unused Lucide imports**

The previous TrustPanel used `Eye`, `Lock`, `ShieldCheck`. The new Colophon uses none. Remove from the imports at the top of the file. Run:

```bash
npm run lint
```

- [ ] **Step 5: Visual check**

`npm run dev`. Scroll past the Editor's Note. The old pill-strip and 3-column trust panel are gone. In their place: a single Colophon section with the same three trust claims (scope/storage/revocation), restyled as editorial columns.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): merge TrustStrip + TrustPanel into editorial Colophon"
```

---

### Task 10: Restyle `Faq` → "Letters", replace `FooterCta` → "Subscribe"

Final two landing sections. FAQ keeps the native `<details>` accordion but with serif questions + hairline rules + oxblood chevron. The `gradient-ink` dark CTA block is deleted entirely and replaced with a quiet "Subscribe" end-of-article block.

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `Faq()`**

```tsx
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
            <summary className="cursor-pointer list-none font-serif text-[17px] text-ink [&::-webkit-details-marker]:hidden">
              <span className="inline-flex w-full items-center justify-between gap-4">
                <span>{it.q}</span>
                <span
                  aria-hidden
                  className="font-serif text-[18px] text-oxblood transition-transform duration-[180ms] ease-soft group-open:rotate-180"
                >
                  ▾
                </span>
              </span>
            </summary>
            <div className="mt-3 font-serif text-[15px] leading-relaxed text-ink/85">
              {it.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
```

The previous `rounded-card border bg-card shadow-xs` wrapper is replaced by `border-y border-ink/15` — two horizontal hairlines bracketing the accordion, items separated by internal hairlines. No card frame.

- [ ] **Step 2: Replace `FooterCta()` with a `Subscribe()` block**

Delete the entire `function FooterCta() { ... }` block. Add this in its place:

```tsx
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
```

The dark `gradient-ink` block is gone. The CTA is a quiet end-of-article invitation.

- [ ] **Step 3: Update `Home()` to use `<Subscribe />`**

In the `Home()` JSX, replace `<FooterCta />` with `<Subscribe />`:

```tsx
<div className="space-y-24">
  <Hero />
  <HowItWorks />
  <Colophon />
  <Faq />
  <Subscribe />
</div>
```

- [ ] **Step 4: Visual check**

`npm run dev`. Scroll through the landing page top-to-bottom:
- Hero with paper CV excerpt on the right.
- Editor's Note (three columns).
- Colophon (scope/storage/revocation).
- Letters (accordion with hairline rules, oxblood chevron).
- Subscribe (quiet end-of-article, hairline above, italic Fraunces, sign-in button).

Top to bottom should read as one coherent editorial article. No leftover indigo. No gradients.

- [ ] **Step 5: Run typecheck and lint**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): editorial Letters (FAQ) + Subscribe end-of-article"
```

---

## Phase 5 — `/cv` redesign

### Task 11: New `/cv` Masthead — replace gradient profile header with editorial masthead + stat strip

The biggest /cv change. Replace the gradient hero block + four `MetricTile` cards with a sober masthead: kicker → italic Fraunces name → hairline → affiliation → stat strip. Add a new helper `volumeRoman()` (with a unit test, since this is new logic — see CLAUDE.md exception for new-logic TDD).

**Files:**
- Create: `lib/cv/volumeRoman.ts`
- Create: `tests/cv/volumeRoman.test.ts`
- Modify: `app/(app)/cv/page.tsx`

- [ ] **Step 1: Write the failing test for `volumeRoman()`**

Create `tests/cv/volumeRoman.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { volumeRoman } from '@/lib/cv/volumeRoman';

describe('volumeRoman', () => {
  it('returns "I" for null activeYears (no tournaments yet)', () => {
    expect(volumeRoman(null)).toBe('I');
  });

  it('returns "I" for a one-year span', () => {
    expect(volumeRoman({ from: 2024, to: 2024 })).toBe('I');
  });

  it('returns "III" for a three-year span', () => {
    expect(volumeRoman({ from: 2022, to: 2024 })).toBe('III');
  });

  it('returns "VIII" for an eight-year span', () => {
    expect(volumeRoman({ from: 2017, to: 2024 })).toBe('VIII');
  });

  it('returns "IX" for exactly a nine-year span', () => {
    expect(volumeRoman({ from: 2016, to: 2024 })).toBe('IX');
  });

  it('caps at "IX+" for spans of 10 years or more', () => {
    expect(volumeRoman({ from: 2010, to: 2024 })).toBe('IX+');
    expect(volumeRoman({ from: 2000, to: 2024 })).toBe('IX+');
  });

  it('handles reversed/invalid spans defensively (returns "I")', () => {
    expect(volumeRoman({ from: 2024, to: 2022 })).toBe('I');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- volumeRoman
```

Expected: `Error: failed to load url @/lib/cv/volumeRoman` (or similar — the file doesn't exist yet).

- [ ] **Step 3: Implement `lib/cv/volumeRoman.ts`**

```ts
type ActiveYears = { from: number; to: number } | null;

const ROMAN: Record<number, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
  8: 'VIII',
  9: 'IX',
};

/**
 * Derive the masthead's "VOL. X" Roman numeral from the user's active-year
 * span. A debater in their third active year sees VOL. III. Capped at IX:
 * longer Romans (X, XI...) read awkwardly in a small-caps kicker.
 *
 *  - `null` activeYears (no tournaments yet) → "I"
 *  - reversed span (defensive) → "I"
 *  - span ≥ 10 → "IX+"
 */
export function volumeRoman(activeYears: ActiveYears): string {
  if (!activeYears) return 'I';
  const span = activeYears.to - activeYears.from + 1;
  if (span <= 0) return 'I';
  if (span >= 10) return 'IX+';
  return ROMAN[span] ?? 'I';
}
```

- [ ] **Step 4: Re-run the test**

```bash
npm test -- volumeRoman
```

Expected: all 7 tests pass.

- [ ] **Step 5: Replace the `/cv` masthead in `app/(app)/cv/page.tsx`**

Open `app/(app)/cv/page.tsx`. At the top of the file, add the import:

```tsx
import { volumeRoman } from '@/lib/cv/volumeRoman';
```

Locate the `<header>` block (the gradient profile header, currently lines 83–133) and replace it with:

```tsx
{/* Editorial masthead — replaces the gradient profile + metric-tile grid */}
<header className="space-y-4">
  <div className="kicker">
    DEBATE CV — VOL. {volumeRoman(highlights.activeYears)} · COMPILED{' '}
    {new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).toUpperCase()}
  </div>

  <h1 className="font-serif text-[44px] italic leading-[1.05] tracking-tight text-ink md:text-display">
    {user?.name ?? 'Debater'}.
  </h1>

  <hr className="hairline" />

  <div className="byline">
    {[
      // school placeholder — backend doesn't surface school yet; if user.email present, show it
      user?.email,
      'Auto-compiled from Gmail',
    ]
      .filter(Boolean)
      .join('  ·  ')}
  </div>

  {headerMetrics.length > 0 ? (
    <div
      className={
        'mt-4 grid gap-6 ' +
        (headerMetrics.length === 1
          ? 'grid-cols-1'
          : headerMetrics.length === 2
            ? 'grid-cols-2'
            : headerMetrics.length === 3
              ? 'grid-cols-3'
              : 'grid-cols-2 md:grid-cols-4')
      }
    >
      {headerMetrics.map((m, i) => (
        <StatColumn key={i} label={m.label} value={m.value} mono={m.mono} />
      ))}
    </div>
  ) : null}
</header>
```

- [ ] **Step 6: Replace `MetricTile` with `StatColumn`**

Find the `function MetricTile({ ... }) { ... }` definition (currently around lines 310–339). Replace with:

```tsx
function StatColumn({
  label,
  value,
  mono,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-byline text-ink-soft uppercase tracking-[0.16em] text-[10.5px]">
        {label}
      </div>
      <div className={'mt-1 font-serif text-[28px] text-ink num' + (mono ? '' : '')}>
        {value}
      </div>
    </div>
  );
}
```

(The `mono` flag is preserved in the props interface for API compatibility with `pickHeaderMetrics()`, but visually we now use Fraunces tabular figures everywhere — `mono` is effectively informational and may go away in a later cleanup pass.)

- [ ] **Step 7: Sweep unused imports**

The previous masthead used `MapPin`, `Mail` Lucide icons. These are no longer referenced. Remove from the imports at the top of `app/(app)/cv/page.tsx`. Run:

```bash
npm run lint
```

- [ ] **Step 8: Visual check**

`npm run dev`. Sign in and visit `/cv`. The gradient hero with avatar circle and metric tiles is gone. In its place:
- Oxblood kicker `DEBATE CV — VOL. <I/II/III/...> · COMPILED <DATE>`.
- Big italic Fraunces name.
- Hairline rule.
- Affiliation row (email + "Auto-compiled from Gmail").
- Below: 3–4 stat columns — small label on top, large Fraunces tabular number underneath. No card backgrounds.

If the volume number renders as expected — your real `activeYears` value — confirm the Roman matches the span. (For a one-year span you see VOL. I; for nine years VOL. IX; for ten+ years VOL. IX+.)

- [ ] **Step 9: Restyle `components/CvNeedsAttentionBanners.tsx`**

The banner sits above the masthead, so restyle it as part of this commit. Replace the two warning-yellow boxes with sober ink-rule panels and a `NEEDS ATTENTION` kicker. Open the file and find the JSX `return (` block (around line 106). Replace from `return (` to the trailing `);` with:

```tsx
return (
  <section className="space-y-2" data-print-hide="true" aria-label="Needs attention">
    <div className="kicker">NEEDS ATTENTION</div>
    {pendingCount > 0 ? (
      <div className="flex items-start gap-3 border-t border-ink/10 py-3">
        <Loader2
          className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-oxblood"
          aria-hidden
        />
        <p className="font-serif text-[14.5px] leading-relaxed text-ink">
          <em className="not-italic font-medium">
            Ingesting {pendingCount} {pendingCount === 1 ? 'tournament' : 'tournaments'}.
          </em>{' '}
          <span className="text-ink-soft">
            Rows below will fill in as each finishes.{' '}
            <Link href="/dashboard?filter=pending" className="text-oxblood hover:underline">
              View queue
            </Link>
            .
          </span>
        </p>
      </div>
    ) : null}
    {unmatchedCount > 0 ? (
      <div className="flex items-start gap-3 border-t border-ink/10 py-3">
        <UserSearch className="mt-0.5 h-4 w-4 shrink-0 text-oxblood" aria-hidden />
        <p className="font-serif text-[14.5px] leading-relaxed text-ink">
          <em className="not-italic font-medium">
            {unmatchedCount} {unmatchedCount === 1 ? 'tournament needs' : 'tournaments need'} a claim.
          </em>{' '}
          <span className="text-ink-soft">
            We ingested them but couldn&apos;t match you to a speaker or judge.{' '}
            <Link
              href="/dashboard?filter=unmatched"
              className="text-oxblood hover:underline"
            >
              Find yourself on the dashboard
            </Link>
            .
          </span>
        </p>
      </div>
    ) : null}
  </section>
);
```

Changes:
- The warning-yellow `border-warning/30 bg-warning/5 rounded-card` panels become hairline ink-rule rows on paper.
- Icons re-tinted from `text-warning` to `text-oxblood` (the single editorial accent).
- The `NEEDS ATTENTION` kicker introduces the section.
- Inline `<Link>` colour switches from `text-primary` to `text-oxblood` (semantically identical now that `--primary` is oxblood, but clearer in the source).
- The polling logic, refs, `useEffect`s, and conditional render gating (`if (pendingCount === 0 && unmatchedCount === 0) return null;`) are untouched.

- [ ] **Step 10: Commit**

```bash
git add lib/cv/volumeRoman.ts tests/cv/volumeRoman.test.ts app/(app)/cv/page.tsx components/CvNeedsAttentionBanners.tsx
git commit -m "feat(cv): editorial masthead + needs-attention banner restyle"
```

---

### Task 12: `/cv` "In Brief" section — replace badge row with italic sentence; restyle action row

Replace the existing badge row (`outline` / `success` / `info` badges for tournaments / as-speaker / as-judge) plus the trailing action group (Share, Download PDF, More dropdown) with a single editorial "In Brief" block: kicker → italic sentence → actions on the right.

**Files:**
- Modify: `app/(app)/cv/page.tsx`

- [ ] **Step 1: Add the `toBriefSentence` helper near the top of `app/(app)/cv/page.tsx`**

Add this helper above the `initials()` function (which is around line 34):

```tsx
/**
 * Render the CV summary as a single sober italic sentence in place of
 * coloured "X tournaments / Y as speaker / Z as judge" pill badges.
 * Spells out numbers below 20 in line with the publication's voice.
 */
function toBriefSentence(input: {
  totalTournaments: number;
  speakerCount: number;
  judgeCount: number;
  breaks: number;
  yearStart: number | null;
}): string {
  const spell = (n: number): string => {
    const words: Record<number, string> = {
      1: 'one',
      2: 'two',
      3: 'three',
      4: 'four',
      5: 'five',
      6: 'six',
      7: 'seven',
      8: 'eight',
      9: 'nine',
      10: 'ten',
      11: 'eleven',
      12: 'twelve',
      13: 'thirteen',
      14: 'fourteen',
      15: 'fifteen',
      16: 'sixteen',
      17: 'seventeen',
      18: 'eighteen',
      19: 'nineteen',
    };
    if (n < 20) return words[n] ?? String(n);
    return String(n);
  };

  const parts: string[] = [];
  if (input.totalTournaments > 0) {
    parts.push(
      `${capitalize(spell(input.totalTournaments))} tournament${input.totalTournaments === 1 ? '' : 's'}` +
        (input.yearStart ? ` since ${input.yearStart}.` : '.'),
    );
  }
  if (input.breaks > 0) {
    parts.push(
      `${capitalize(spell(input.breaks))} break${input.breaks === 1 ? '' : 's'}.`,
    );
  }
  if (input.speakerCount > 0 && input.judgeCount > 0) {
    parts.push(
      `Speaker in ${spell(input.speakerCount)}, chair in ${spell(input.judgeCount)}.`,
    );
  } else if (input.speakerCount > 0) {
    parts.push(
      `Speaker in ${spell(input.speakerCount)} tournament${input.speakerCount === 1 ? '' : 's'}.`,
    );
  } else if (input.judgeCount > 0) {
    parts.push(
      `Chair in ${spell(input.judgeCount)} tournament${input.judgeCount === 1 ? '' : 's'}.`,
    );
  }

  return parts.join(' ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 2: Replace the badge + actions row in `CvPage()`**

Find the block in `CvPage()`'s JSX that starts with `{/* Summary row + actions */}` (currently around line 135–164). Replace it with:

```tsx
{/* In Brief — sentence summary + action affordances */}
<section className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
  <div className="md:max-w-2xl">
    <div className="kicker">IN BRIEF</div>
    <p className="mt-2 font-serif text-[17px] italic leading-relaxed text-ink/85">
      {toBriefSentence({
        totalTournaments: summary.totalTournaments,
        speakerCount: speakerRows.length,
        judgeCount: judgeRows.length,
        breaks: summary.breaks,
        yearStart: highlights.activeYears?.from ?? null,
      })}
    </p>
  </div>

  <div className="flex flex-wrap items-center gap-1.5" data-print-hide="true">
    <CvShareButton />
    <DownloadPdfButton />
    <details className="group relative">
      <summary className="list-none">
        <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-ink/15 bg-paper px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-ink/[0.04]">
          More
        </span>
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-[220px] rounded-card border border-ink/15 bg-card p-2 shadow-md">
        <div className="flex flex-col gap-1.5">
          <Link href="/cv/verify">
            <Button variant="outline" size="sm" className="w-full justify-start">
              Verify extracted fields
            </Button>
          </Link>
          <a href="/api/cv/export">
            <Button variant="outline" size="sm" className="w-full justify-start">
              Export CSV
            </Button>
          </a>
        </div>
      </div>
    </details>
  </div>
</section>
```

The three coloured badges are deleted (their data shows up inside the In Brief sentence). The "More" disclosure keeps its existing two options (Verify, Export). The action buttons sit on the right at desktop, below the sentence on mobile.

- [ ] **Step 3: Remove the now-unused `Badge` import (if any only-used-here)**

Run:
```bash
npm run lint
```

If `Badge` is still used elsewhere in the file (the per-row "Reported" badge), keep the import. Otherwise remove.

- [ ] **Step 4: Visual check**

`npm run dev`. Visit `/cv`. Below the masthead, you should see:
- Oxblood `IN BRIEF` kicker.
- Italic Fraunces sentence with your real numbers, e.g. `Twenty-three tournaments since 2018. Nine breaks. Speaker in fifteen, chair in eight.`
- On the right (desktop): Share, Print, More buttons in outlined-ink style.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/cv/page.tsx
git commit -m "feat(cv): editorial In Brief sentence replaces badge row"
```

---

### Task 13: Restyle `CvHighlights.tsx` → "Career notes"

Convert the existing `<Sparkles /> Highlights` section into a "Career notes · Highlights" editorial block: kicker → italic Fraunces section title → tiles become hairline-separated columns with oxblood kickers and italic titles.

**Files:**
- Modify: `components/CvHighlights.tsx`

- [ ] **Step 1: Replace `components/CvHighlights.tsx`**

```tsx
import { Trophy, Mic, GraduationCap, Gavel, Crown, Globe } from 'lucide-react';
import type { CvHighlights as CvHighlightsData } from '@/lib/cv/buildCvData';

/**
 * Auto-generated highlights reel — restyled as editorial "career notes"
 * (a 2- or 3-column flow on paper, separated by hairlines, with oxblood
 * kickers and italic Fraunces titles). The selection logic is unchanged;
 * we only swap the presentation.
 */
export function CvHighlights({ highlights }: { highlights: CvHighlightsData }) {
  const {
    championships,
    topBreaks,
    bestSpeakerRank,
    bestSpeakerAverage,
    outroundsChaired,
    adjCoreCount,
    majorEvents,
  } = highlights;

  const tiles: Array<{
    kicker: string;
    title: string;
    items: string[];
    icon: React.ReactNode;
  }> = [];

  if (championships.length > 0) {
    tiles.push({
      kicker: 'CHAMPIONSHIPS',
      title: `Champion (${championships.length})`,
      items: championships.map((c) => `${c.tournamentName}${c.year ? ` ${c.year}` : ''}`),
      icon: <Trophy className="h-4 w-4" aria-hidden />,
    });
  }
  if (topBreaks.length > 0) {
    tiles.push({
      kicker: 'DEEPEST BREAKS',
      title: `Top-10% break (${topBreaks.length})`,
      items: topBreaks.map(
        (b) =>
          `#${b.rank}/${b.totalTeams} · ${b.tournamentName}${b.year ? ` ${b.year}` : ''}`,
      ),
      icon: <Mic className="h-4 w-4" aria-hidden />,
    });
  }
  if (bestSpeakerRank) {
    tiles.push({
      kicker: 'BEST FORM',
      title: 'Best speaker rank',
      items: [
        `#${bestSpeakerRank.rank} · ${bestSpeakerRank.tournamentName}${bestSpeakerRank.year ? ` ${bestSpeakerRank.year}` : ''}`,
      ],
      icon: <GraduationCap className="h-4 w-4" aria-hidden />,
    });
  }
  if (bestSpeakerAverage) {
    tiles.push({
      kicker: 'PEAK AVERAGE',
      title: 'Best speaker average',
      items: [
        `${bestSpeakerAverage.score.toFixed(1)} · ${bestSpeakerAverage.tournamentName}${bestSpeakerAverage.year ? ` ${bestSpeakerAverage.year}` : ''}`,
      ],
      icon: <GraduationCap className="h-4 w-4" aria-hidden />,
    });
  }
  if (outroundsChaired > 0) {
    tiles.push({
      kicker: 'MOST CHAIRED',
      title: 'Outrounds chaired',
      items: [`${outroundsChaired} ${outroundsChaired === 1 ? 'outround' : 'outrounds'}`],
      icon: <Gavel className="h-4 w-4" aria-hidden />,
    });
  }
  if (adjCoreCount > 0) {
    tiles.push({
      kicker: 'ADJUDICATION CORE',
      title: 'Adj core',
      items: [`${adjCoreCount} ${adjCoreCount === 1 ? 'tournament' : 'tournaments'}`],
      icon: <Crown className="h-4 w-4" aria-hidden />,
    });
  }
  if (majorEvents.length > 0) {
    tiles.push({
      kicker: 'MAJOR CIRCUIT',
      title: `Major-circuit (${majorEvents.length})`,
      items: majorEvents.map((m) => `${m.tournamentName}${m.year ? ` ${m.year}` : ''}`),
      icon: <Globe className="h-4 w-4" aria-hidden />,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <section aria-label="Career notes">
      <header className="mb-6 max-w-2xl">
        <div className="kicker">CAREER NOTES · HIGHLIGHTS</div>
        <h2 className="mt-3 font-serif text-h2 italic text-ink">
          Notable moments.
        </h2>
      </header>

      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t, i) => (
          <article
            key={i}
            className="border-t border-ink/10 pt-4"
          >
            <div className="kicker flex items-center gap-1.5">
              <span className="text-oxblood">{t.icon}</span>
              {t.kicker}
            </div>
            <h3 className="mt-2 font-serif text-h3 italic text-ink">{t.title}</h3>
            <ul className="mt-1 space-y-0.5 font-serif text-[14.5px] leading-relaxed text-ink/80">
              {t.items.map((item, j) => (
                <li key={j} className="break-words">{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
```

The previous Card wrapper + the inner `<Tile>` component are deleted. Tiles become flow articles on paper, separated by a hairline at the top of each.

- [ ] **Step 2: Visual check**

`npm run dev`. Visit `/cv`. The "Highlights" section is now "CAREER NOTES · HIGHLIGHTS", with two- or three-column flow of notes, each with an oxblood kicker, italic Fraunces title, and serif body.

- [ ] **Step 3: Commit**

```bash
git add components/CvHighlights.tsx
git commit -m "feat(cv): editorial Career notes — kicker + italic titles, hairline-separated"
```

---

### Task 14: Restyle the `/cv` Speaking + Judging tables ("The Record")

The two `<CollapsibleSection>`-wrapped tables (Speaking, Judging) drop their card wrappers and `<details>` chrome in favour of section kickers + ink-rule-above-header tables. Replace mobile stacked cards with paper-on-paper variants. Replace `BrokeBadge` and "Reported" `Badge` with small-caps quiet labels.

**Files:**
- Modify: `app/(app)/cv/page.tsx`

- [ ] **Step 1: Delete the `CollapsibleSection` component**

The page-local `CollapsibleSection` component (currently around lines 341–373) is no longer needed — section headers become inline kickers instead. Delete the function. Remove its `<CollapsibleSection>` invocations from the `CvPage` JSX.

- [ ] **Step 2: Replace the Speaking section invocation**

Find the line `{speakerRows.length > 0 ? (` in `CvPage()` and replace through the closing `) : null}` for Speaking with:

```tsx
{speakerRows.length > 0 ? (
  <section aria-label="Speaking" className="space-y-4">
    <header>
      <div className="kicker">I · SPEAKING — {speakerRows.length} TOURNAMENT{speakerRows.length === 1 ? '' : 'S'}</div>
    </header>
    <SpeakingTable rows={speakerRows} />
  </section>
) : null}
```

- [ ] **Step 3: Replace the Judging section invocation**

Similarly for Judging:

```tsx
{judgeRows.length > 0 ? (
  <section aria-label="Judging" className="space-y-4">
    <header>
      <div className="kicker">II · JUDGING — {judgeRows.length} TOURNAMENT{judgeRows.length === 1 ? '' : 'S'}</div>
    </header>
    <JudgingTable rows={judgeRows} />
  </section>
) : null}
```

- [ ] **Step 4: Restyle `BrokeBadge`**

Find `function BrokeBadge({ broke }) { ... }` (around line 390). Replace with:

```tsx
function BrokeBadge({ broke }: { broke: boolean }) {
  return (
    <span className="uppercase tracking-[0.14em] text-[10.5px] font-semibold text-ink-soft">
      {broke ? 'Broken' : '—'}
    </span>
  );
}
```

- [ ] **Step 5: Restyle the `SpeakingTable` thead + tbody styling**

Find `function SpeakingTable({ rows }) { ... }` (around line 528). The desktop table wrapper currently is:

```tsx
<div className="hidden max-w-full overflow-x-auto md:block">
  <table className="min-w-max text-[13.5px]">
    <thead>
      <tr className="border-b border-border bg-muted/30 text-left align-bottom text-caption text-muted-foreground">
```

Change to:

```tsx
<div className="hidden max-w-full overflow-x-auto md:block">
  <table className="min-w-max text-[13.5px]">
    <thead>
      <tr className="border-y border-ink/15 text-left align-bottom uppercase tracking-[0.14em] text-[10.5px] font-semibold text-ink-soft">
```

The `bg-muted/30` background goes away — header sits on paper between two hairlines.

Inside the same `SpeakingTable`, sweep all `font-mono` class usages on `<td>` cells and replace with `num` (Tailwind's `.num` utility from globals.css). Search the function body for `font-mono` and change to `num`.

Also: the row `className="align-top hover:bg-muted/20"` on the `<tr>` becomes `className="align-top border-b border-ink/10 hover:bg-ink/[0.02]"` — hairline divider, no card highlight.

- [ ] **Step 6: Replace the "Reported" `<Badge variant="warning">` markup in `SpeakingRow`**

In `SpeakingRow` (around line 422), the Reported badge currently renders as:

```tsx
{r.hasOpenReport ? <Badge variant="warning">Reported</Badge> : null}
```

Change to:

```tsx
{r.hasOpenReport ? (
  <span className="uppercase tracking-[0.14em] text-[10.5px] font-semibold text-oxblood border-b border-oxblood/40">
    Reported
  </span>
) : null}
```

Same in `JudgingTable`.

- [ ] **Step 7: Restyle the per-round expansion `<details>`**

In `SpeakingRow`, the inner row that renders per-round speaker scores has a `tr` with `className="bg-muted/10"`. Change to `className="bg-paper"`. The `<summary>` line: `className="cursor-pointer select-none py-1.5 text-caption text-muted-foreground hover:text-foreground"` becomes `className="cursor-pointer select-none py-1.5 text-byline text-ink-soft hover:text-ink"`. The `<ChevronDown>` icon stays but with `text-oxblood` instead of default.

- [ ] **Step 8: Restyle `JudgingTable`**

Mirror the same changes in `JudgingTable`:
- `border-b border-border bg-muted/30` → `border-y border-ink/15` on thead row.
- Add small-caps tracking on thead.
- Replace `font-mono` with `num` on td cells.
- Row hover: `hover:bg-ink/[0.02] border-b border-ink/10`.

- [ ] **Step 9: Restyle the mobile stacked variants (`<ul className="... md:hidden">`)**

In `SpeakingTable`, the mobile variant currently has:

```tsx
<ul className="divide-y divide-border md:hidden">
  {rows.map((r) => (
    <li key={r.tournamentId.toString()} className="space-y-2 p-4">
```

Change to:

```tsx
<ul className="md:hidden">
  {rows.map((r) => (
    <li key={r.tournamentId.toString()} className="space-y-2 border-t border-ink/10 py-5">
```

Inside the `<li>`, the tournament-name anchor's `className="truncate font-display text-[14.5px] font-semibold text-foreground"` becomes `className="truncate font-serif italic text-[15.5px] text-ink"`.

The `Field` component (defined in the same file) — its `<dt>` `text-caption text-muted-foreground` becomes `text-byline text-ink-soft uppercase tracking-[0.12em]`. The `<dd>` stays as `text-ink` (was `text-foreground`).

Make the parallel changes in `JudgingTable`'s mobile variant.

- [ ] **Step 10: Visual check**

`npm run dev`. Visit `/cv` with multiple tournaments. Expected:
- Two sections: `I · SPEAKING — N TOURNAMENTS`, `II · JUDGING — M TOURNAMENTS`.
- No card frames around the tables.
- Table headers in small caps, between hairlines.
- Row dividers: hairlines, no zebra.
- Tournament names: italic Fraunces.
- Numeric columns: tabular figures (not monospace).
- `BROKEN` / `—` text labels instead of green/grey pills.
- `REPORTED` rows show a small oxblood-underlined label.
- Mobile: stacked cards become paper-on-paper with hairline-top per item.

- [ ] **Step 11: Test the per-round expansion**

Click the "Per-round speaker scores (N)" `<details>` toggle on a speaker row. Confirm it expands and shows the round scores. Chevron should be oxblood.

- [ ] **Step 12: Commit**

```bash
git add app/(app)/cv/page.tsx
git commit -m "feat(cv): editorial Record tables — section kickers, hairlines, quiet badges"
```

---

## Phase 6 — `/u/<slug>` redesign

### Task 15: `/u/<slug>` masthead (formal mode)

Replace the gradient-avatar masthead with the formal editorial masthead: kicker → italic Fraunces name → hairline → "N TOURNAMENTS · VERIFIED VIA PRIVATE URLS" annotation → print button on the right.

**Files:**
- Modify: `app/u/[slug]/page.tsx`

- [ ] **Step 1: Add the volumeRoman import isn't needed (public page uses "PUBLIC RECORD" not VOL)**

(Skipped — the public masthead uses a different kicker format that doesn't need the volume helper.)

- [ ] **Step 2: Replace the `<header>` block**

In `app/u/[slug]/page.tsx`, find the `<header className="flex flex-col items-start gap-4 md:flex-row md:items-center md:gap-6">` block (lines 81–111) and replace it with:

```tsx
{/* Public CV masthead — formal mode */}
<header className="space-y-4">
  <div className="kicker">
    DEBATE CV — PUBLIC RECORD · COMPILED{' '}
    {new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).toUpperCase()}
  </div>

  <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
    <div className="flex items-end gap-5">
      {user.publicAvatarEnabled && user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt={user.name ?? 'Debater'}
          className="h-20 w-20 rounded border border-ink/20 object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded border border-ink/20 bg-paper font-serif italic text-[26px] text-ink">
          {initials(user.name)}
        </div>
      )}
      <h1 className="font-serif text-[44px] italic leading-[1.05] tracking-tight text-ink md:text-[64px]">
        {user.name ?? 'Debater'}.
      </h1>
    </div>
    <div data-print-hide="true">
      <DownloadPdfButton />
    </div>
  </div>

  <hr className="hairline" />

  <div className="byline uppercase tracking-[0.16em] text-[11px] text-ink-soft">
    {spellOrCount(totalIngestedTournaments)} tournament{totalIngestedTournaments === 1 ? '' : 's'} · verified via private URLs
    {summary.totalTournaments > 0 && summary.totalTournaments !== totalIngestedTournaments
      ? ` · ${summary.totalTournaments} on record`
      : ''}
  </div>
</header>
```

Add the `spellOrCount` helper at the bottom of the file (near `initials`):

```tsx
function spellOrCount(n: number): string {
  const words: Record<number, string> = {
    1: 'one',
    2: 'two',
    3: 'three',
    4: 'four',
    5: 'five',
    6: 'six',
    7: 'seven',
    8: 'eight',
    9: 'nine',
    10: 'ten',
    11: 'eleven',
    12: 'twelve',
    13: 'thirteen',
    14: 'fourteen',
    15: 'fifteen',
    16: 'sixteen',
    17: 'seventeen',
    18: 'eighteen',
    19: 'nineteen',
  };
  return n < 20 ? (words[n] ?? String(n)) : String(n);
}
```

- [ ] **Step 3: Remove the now-unused `Badge` and `Trophy` imports if any**

Run:
```bash
npm run lint
```

The `<Badge variant="success">` and `<Trophy />` were the only consumers of those imports on this page. Remove them.

- [ ] **Step 4: Visual check**

`npm run dev`. Visit a public CV URL (e.g. `http://localhost:3000/u/<your-slug>`). Expected:
- Oxblood kicker `DEBATE CV — PUBLIC RECORD · COMPILED <DATE>`.
- Avatar (or italic monogram) on the left, large italic Fraunces name on the right.
- Hairline rule.
- Small-caps `N TOURNAMENTS · VERIFIED VIA PRIVATE URLS` annotation.
- Print to PDF button on the right of the masthead, restyled outlined-ink.

Verify the global sticky header is **still gone** on this route — that's the architectural payoff from Task 3.

- [ ] **Step 5: Commit**

```bash
git add app/u/[slug]/page.tsx
git commit -m "feat(public-cv): formal editorial masthead — kicker, italic name, verified annotation"
```

---

### Task 16: `/u/<slug>` "The Record" — restyle Speaking + Judging + add provenance footnotes

Apply the same record-style table treatment as `/cv` to the public Speaking + Judging tables, plus a sober credit line under each table identifying the data source.

**Files:**
- Modify: `app/u/[slug]/page.tsx`

- [ ] **Step 1: Restyle the Speaking section**

Find the `{speakerRows.length > 0 ? (` block in `PublicCvPage`. Replace it with:

```tsx
{speakerRows.length > 0 ? (
  <section aria-label="Speaking" className="space-y-4">
    <header>
      <div className="kicker">I · SPEAKING — {speakerRows.length} TOURNAMENT{speakerRows.length === 1 ? '' : 'S'}</div>
    </header>
    <div className="overflow-x-auto">
      <table className="min-w-max text-[13px]">
        <thead className="border-y border-ink/15 uppercase tracking-[0.14em] text-[10.5px] font-semibold text-ink-soft">
          <tr>
            <th className="px-4 py-2.5 text-left">Tournament</th>
            <th className="px-4 py-2.5 text-left">Year</th>
            <th className="px-4 py-2.5 text-left">Format</th>
            <th className="px-4 py-2.5 text-left">Team</th>
            <th className="px-4 py-2.5 text-left">Team rank</th>
            <th className="px-4 py-2.5 text-left">Speaker rank</th>
            <th className="px-4 py-2.5 text-left">Avg score</th>
            <th className="px-4 py-2.5 text-left">Outround</th>
          </tr>
        </thead>
        <tbody>
          {speakerRows.map((r) => (
            <tr key={r.tournamentId.toString()} className="border-b border-ink/10">
              <td className="px-4 py-2.5">
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-serif italic text-ink hover:text-oxblood"
                >
                  {r.tournamentName}
                </a>
              </td>
              <td className="px-4 py-2.5 text-ink-soft num">{r.year ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink-soft">{r.format ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink">{r.teamName ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink-soft num">
                {r.teamRank != null ? `#${r.teamRank}` : '—'}
              </td>
              <td className="px-4 py-2.5 text-ink-soft num">
                {r.speakerRankOpen != null ? `#${r.speakerRankOpen}` : '—'}
              </td>
              <td className="px-4 py-2.5 text-ink-soft num">{r.speakerAvgScore ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink-soft">{fmtPublicLastOutround(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="font-serif italic text-[11.5px] text-ink-soft">
      Source: tournament tabs at calicotab.com · herokuapp.com.
    </p>
  </section>
) : null}
```

- [ ] **Step 2: Restyle the Judging section**

Mirror the same treatment:

```tsx
{judgeRows.length > 0 ? (
  <section aria-label="Judging" className="space-y-4">
    <header>
      <div className="kicker">II · JUDGING — {judgeRows.length} TOURNAMENT{judgeRows.length === 1 ? '' : 'S'}</div>
    </header>
    <div className="overflow-x-auto">
      <table className="min-w-max text-[13px]">
        <thead className="border-y border-ink/15 uppercase tracking-[0.14em] text-[10.5px] font-semibold text-ink-soft">
          <tr>
            <th className="px-4 py-2.5 text-left">Tournament</th>
            <th className="px-4 py-2.5 text-left">Year</th>
            <th className="px-4 py-2.5 text-left">Format</th>
            <th className="px-4 py-2.5 text-left">Prelims chaired</th>
            <th className="px-4 py-2.5 text-left">Prelims judged</th>
            <th className="px-4 py-2.5 text-left">Last outround chaired</th>
            <th className="px-4 py-2.5 text-left">Last outround judged</th>
          </tr>
        </thead>
        <tbody>
          {judgeRows.map((r) => (
            <tr key={r.tournamentId.toString()} className="border-b border-ink/10">
              <td className="px-4 py-2.5">
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-serif italic text-ink hover:text-oxblood"
                >
                  {r.tournamentName}
                </a>
              </td>
              <td className="px-4 py-2.5 text-ink-soft num">{r.year ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink-soft">{r.format ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink-soft num">{r.inroundsChaired ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink-soft num">{r.inroundsJudged ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink-soft">{r.lastOutroundChaired ?? '—'}</td>
              <td className="px-4 py-2.5 text-ink-soft">{r.lastOutroundJudged ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="font-serif italic text-[11.5px] text-ink-soft">
      Source: tournament tabs at calicotab.com · herokuapp.com.
    </p>
  </section>
) : null}
```

- [ ] **Step 3: Visual check**

`npm run dev`. Visit `/u/<your-slug>`. Expected:
- Two sections (`I · SPEAKING`, `II · JUDGING`) with the same record-style as `/cv` but the narrower public column set.
- Tournament names link out to the Tabbycat source URL (critical credibility feature).
- A sober italic provenance footnote under each table: *"Source: tournament tabs at calicotab.com · herokuapp.com."*

Verify with the dev server running that clicking a tournament name still opens the public Tabbycat URL in a new tab.

- [ ] **Step 4: Commit**

```bash
git add app/u/[slug]/page.tsx
git commit -m "feat(public-cv): editorial Record tables with provenance footnotes"
```

---

### Task 17: `/u/<slug>` colophon footer

Replace the current public-CV footer (`<BrandMark> · Built on debate cv. Build your own →`) with a paper colophon: hairline rule above, italic Fraunces credit on the left, small outlined-ink "Build your own →" on the right.

**Files:**
- Modify: `app/u/[slug]/layout.tsx`

- [ ] **Step 1: Replace the contents of `app/u/[slug]/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Dedicated layout for public CVs. Strips all app chrome — no nav, no
 * notification bell, no settings/dashboard links — so the page reads
 * like a credentialing artifact rather than a tab in someone else's app.
 *
 * With the (app) route-group split applied in the editorial redesign,
 * the global sticky header no longer leaks into this route. This layout
 * only adds the page wrapper, the paper background, and the colophon
 * footer.
 */
export default function PublicCvLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-14 px-5 pb-16 pt-10">
      {children}
      <footer className="pt-10">
        <hr className="hairline" />
        <div className="mt-6 flex flex-col items-start justify-between gap-3 text-[13px] text-ink-soft sm:flex-row sm:items-center">
          <div className="font-serif italic text-ink-soft">
            — Compiled by debate cv.
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md border border-ink/15 bg-paper px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-ink/[0.04]"
          >
            Build your own →
          </Link>
        </div>
      </footer>
    </div>
  );
}
```

The previous `BrandMark` import is no longer needed here (the public footer doesn't render the wordmark — only the italic credit line). Tweaked container width to `max-w-5xl` and added bottom padding for a more document-y feel.

- [ ] **Step 2: Visual check**

`npm run dev`. Visit `/u/<your-slug>`. Scroll to the bottom. Expected:
- Hairline rule.
- Left: italic Fraunces `— Compiled by debate cv.`
- Right: small `outlined-ink` link `Build your own →` that targets `/`.
- No app nav anywhere on the page.

- [ ] **Step 3: Commit**

```bash
git add app/u/[slug]/layout.tsx
git commit -m "feat(public-cv): editorial colophon footer + paper-on-paper layout"
```

---

## Phase 7 — Final verification

### Task 18: Print preview, full typecheck, lint, build

End-to-end sanity check: confirm the print stylesheet still produces a clean artifact on both `/cv` and `/u/<slug>`, run the full test/lint/build pipeline, and produce before/after notes.

**Files:** (verification only — no source changes unless something breaks)

- [ ] **Step 1: Print preview `/cv`**

Sign in. Visit `/cv`. Open browser print preview (Ctrl+P / Cmd+P).

Expected:
- Page background: white (overridden from cream by the `@media print` block).
- Text: black ink.
- Sticky header from `(app)` layout: hidden (the existing print stylesheet hides `header[class*="sticky"]`).
- "More ↓" dropdown, Share button, Print button: hidden (`data-print-hide="true"`).
- "Needs attention" banner: visible if applicable; nothing redacted.
- The masthead, In Brief, Career notes, and both Record tables print across page breaks without splitting rows.
- Per-round speaker score expansions: forced open (existing `@media print` rule forces `<details>` open, hides `<summary>`).

If anything looks wrong, the print rules in `app/globals.css` may need additions — but only add what's necessary; the existing rules are intentionally conservative.

- [ ] **Step 2: Print preview `/u/<slug>`**

Same exercise on a public CV. Expected:
- White paper.
- No header (it's not even rendered in the (app) split — this is cleaner than before).
- No "Build your own →" link, no `DownloadPdfButton` (both `data-print-hide`d or, in the case of the Build-your-own link, manually hidden by adding `data-print-hide="true"` if needed).

If the "Build your own →" footer link prints visibly and you want it hidden, add `data-print-hide="true"` to that `<Link>` in `app/u/[slug]/layout.tsx`. Otherwise leave it — a single credit footer line is fine.

- [ ] **Step 3: Full typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Full lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 5: Full test suite**

```bash
npm test
```

Expected: all tests pass, including the new `volumeRoman` suite from Task 11.

- [ ] **Step 6: Full build**

```bash
npm run build
```

Expected: build succeeds. Watch for any console warnings about removed Tailwind classes (`bg-gradient-hero`, etc.) — if they appear, double-check that no source file still references them.

- [ ] **Step 7: Visual smoke test of every redesigned surface**

Open `http://localhost:3000` in a fresh browser session and walk through:

1. **Landing (signed out)** — hero with paper CV excerpt; Editor's Note; Colophon; Letters; Subscribe.
2. **/cv (signed in, multi-tournament)** — editorial masthead with VOL.<roman>; In Brief sentence; Career notes; The Record (Speaking + Judging) tables.
3. **/cv (signed in, empty state)** — confirm the EmptyState still renders properly with the new editorial typography.
4. **/u/<slug> (public, your own)** — formal masthead; Career notes; Record tables with provenance footnotes; paper colophon. **No global app nav visible.**
5. **/dashboard, /settings, /onboarding** — confirm they pick up the new tokens (paper, ink, oxblood) but aren't broken visually. These aren't redesigned this pass but should inherit the new palette gracefully.

- [ ] **Step 8: Final commit (if any fix-ups were needed)**

If any of the above steps surfaced a fix-up, commit it. Otherwise no commit needed.

```bash
git status
# If clean, no commit
# Else:
git add -A
git commit -m "chore(design): editorial redesign final verification fixes"
```

---

## Plan complete

The implementation finishes after Task 18. All visual changes land across 17 commits (one per phase task) plus an optional 18th for verification fix-ups. The codebase ships with:

- A coherent editorial design language (paper, ink, oxblood, italic Fraunces, hairline rules, sober kickers).
- A redesigned landing, `/cv`, and `/u/<slug>`.
- A small structural refactor (`(app)` route group) so the public CV is no longer polluted by app chrome.
- One new unit-tested helper (`volumeRoman`).
- All preserved behaviour: data, computations, redirects, queue, Gmail flow, print stylesheet, accessibility scaffolding.

Out of scope (future passes):
- Dashboard / Settings / Onboarding editorial restyle (they get the token shift only).
- Dark mode.
- OG image redesign.
