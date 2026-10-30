/**
 * The link-preview card (Open Graph and X/Twitter), drawn for `next/og`.
 *
 * This is the first thing anyone sees of a shared CV: every `/u/<slug>` link
 * pasted into a chat unfurls into it. It used to carry the retired editorial
 * direction (Georgia italic, oxblood, "compiled from your inbox", "Sign in
 * with Google"), which DESIGN_INSTRUCTIONS §4 and §11 list as what should
 * die. It now follows Ledger: the statement canvas, ledger ink, one emerald
 * accent (the BrandMark tile), no serif and no italics, and the landing
 * hero's own copy.
 *
 * With no `person` it is generic and names no one (the landing page and any
 * disabled or missing profile). `app/u/[slug]/opengraph-image.tsx` passes a
 * person only after re-checking `publicCvEnabled` at render time; chat clients
 * cache unfurls, so that route sends a short max-age.
 *
 * A person's card (redesign owner decision 12, 2026-10-29) is the public
 * CV's own header in miniature: the name, the speaking career chart (only
 * the speaking one: two charts at this size read as noise) and three
 * figures, tournaments, breaks and best finish, under one emerald rule. It
 * is always light, whatever the visitor's theme, like print.
 *
 * Satori (the renderer behind `next/og`) has no access to the app's web
 * fonts without fetching them, and this image is prerendered at build time,
 * where a network fetch is a build failure waiting to happen. It uses the
 * renderer's bundled sans instead, which keeps the Ledger rule that matters
 * here: a sans voice, never a serif one. Colours are the light-theme tokens
 * from app/globals.css converted to hex, because Satori does not resolve CSS
 * variables.
 */

import type { CareerSeries, SpeakingTier } from '@/lib/cv/careerChart';

const LEDGER = {
  canvas: '#F6F7F9', // --background 210 20% 97%
  card: '#FFFFFF', // --card
  ink: '#141B24', // --foreground 213 27% 11%
  muted: '#626C7A', // --muted-foreground 213 11% 43%
  emerald: '#0D634F', // --primary 166 76% 22%
  rule: 'rgba(84, 100, 120, 0.22)', // --border 213 18% 40% at hairline opacity
} as const;

// The career chart's light-theme tiers (app/globals.css), as hex for Satori.
const TIER: Record<SpeakingTier, string> = {
  none: '#B4BCC6', // --tier-none 213 14% 74%
  broke: '#4583D3', // --tier-broke 214 62% 55%
  f: '#0E3C81', // --tier-f 216 80% 28%
  champion: '#8E6215', // --break-gold 38 74% 32%
};

const TRUST = ['Read-only Gmail', 'Private until shared', 'Source-backed rows'];

export type ShareCardPerson = {
  name: string;
  tournaments: number;
  speakingBreaks: number;
  judgingBreaks: number;
  activeYears?: string | null;
  /** "Semifinals", "ESL Champion"; null when no speaking break. */
  bestFinish?: string | null;
  speaking?: CareerSeries<SpeakingTier> | null;
};

/**
 * The speaking chart drawn in flex boxes: one column per year, one cell per
 * tournament, bottom to top by tier, height scaled to the busiest year.
 * No stars, labels per cell or interaction; the year sits under each bar.
 */
function MiniChart({ series }: { series: CareerSeries<SpeakingTier> }) {
  const years = series.years.slice(-12);
  const max = Math.max(1, ...years.map((y) => y.cells.length));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 420 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          height: 190,
          borderBottom: `2px solid ${LEDGER.ink}`,
        }}
      >
        {years.map((y) => (
          <div
            key={y.year}
            style={{
              display: 'flex',
              flexDirection: 'column-reverse',
              gap: 2,
              flex: 1,
              height: `${(y.cells.length / max) * 100}%`,
            }}
          >
            {y.cells.map((c, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  background: TIER[c.tier],
                  borderRadius: 2,
                  border: c.major ? `3px solid ${LEDGER.ink}` : 'none',
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 16, color: LEDGER.muted }}>
        {years.map((y) => (
          <div key={y.year} style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            {`'${String(y.year).slice(-2)}`}
          </div>
        ))}
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: LEDGER.muted,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>{value}</div>
    </div>
  );
}

/** The person's card: name and figures on the left, the speaking chart on the right. */
function PersonCard({ person }: { person: ShareCardPerson }) {
  // Speaking breaks only, beside the speaking chart: speaking and judging
  // breaks are never added together (owner rule 2026-10-27), and "Broke" is
  // the Record tile's own word for this figure.
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 620 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: LEDGER.emerald,
            }}
          >
            Public debate record
          </div>
          <div style={{ fontSize: 68, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2 }}>
            {person.name}
          </div>
          {person.activeYears ? (
            <div
              style={{ fontSize: 26, color: LEDGER.muted }}
            >{`Active ${person.activeYears}`}</div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 48 }}>
          <Figure label="Tournaments" value={String(person.tournaments)} />
          <Figure label="Broke" value={String(person.speakingBreaks)} />
          {person.bestFinish ? <Figure label="Best finish" value={person.bestFinish} /> : null}
        </div>
      </div>
      {person.speaking && person.speaking.years.length > 0 ? (
        <MiniChart series={person.speaking} />
      ) : null}
    </div>
  );
}

export function ShareCard({ person }: { person?: ShareCardPerson } = {}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: LEDGER.canvas,
        color: LEDGER.ink,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: 10,
            background: LEDGER.emerald,
            color: '#FFFFFF',
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          CV
        </div>
        <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>debate cv</div>
      </div>

      {person ? (
        <PersonCard person={person} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: 3,
              textTransform: 'uppercase',
              color: LEDGER.emerald,
            }}
          >
            Verified tournament record
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 1000,
            }}
          >
            Your debate record, built from your tabs
          </div>
          <div style={{ fontSize: 28, color: LEDGER.muted, maxWidth: 940, lineHeight: 1.4 }}>
            {'Every tournament, round and motion, read from the tab pages you were already sent.'}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          // The person card's one emerald rule (decision 12); the generic
          // card keeps the hairline.
          borderTop: person ? `2px solid ${LEDGER.emerald}` : `1px solid ${LEDGER.rule}`,
          paddingTop: 24,
          fontSize: 20,
          fontWeight: 500,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: LEDGER.muted,
        }}
      >
        {TRUST.map((t, i) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 ? <span style={{ margin: '0 20px', color: LEDGER.rule }}>·</span> : null}
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
