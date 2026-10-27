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
 * Satori (the renderer behind `next/og`) has no access to the app's web
 * fonts without fetching them, and this image is prerendered at build time,
 * where a network fetch is a build failure waiting to happen. It uses the
 * renderer's bundled sans instead, which keeps the Ledger rule that matters
 * here: a sans voice, never a serif one. Colours are the light-theme tokens
 * from app/globals.css converted to hex, because Satori does not resolve CSS
 * variables.
 */

const LEDGER = {
  canvas: '#F6F7F9', // --background 210 20% 97%
  card: '#FFFFFF', // --card
  ink: '#141B24', // --foreground 213 27% 11%
  muted: '#626C7A', // --muted-foreground 213 11% 43%
  emerald: '#0D634F', // --primary 166 76% 22%
  rule: 'rgba(84, 100, 120, 0.22)', // --border 213 18% 40% at hairline opacity
} as const;

const TRUST = ['Read-only Gmail', 'Private until shared', 'Source-backed rows'];

export type ShareCardPerson = {
  name: string;
  tournaments: number;
  breaks: number;
  activeYears?: string | null;
};

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
          {person ? 'Public debate record' : 'Verified tournament record'}
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
          {person ? person.name : 'Your debate history, kept like an account'}
        </div>
        <div style={{ fontSize: 28, color: LEDGER.muted, maxWidth: 940, lineHeight: 1.4 }}>
          {person
            ? [
                `${person.tournaments} tournament${person.tournaments === 1 ? '' : 's'}`,
                person.breaks > 0 ? `${person.breaks} break${person.breaks === 1 ? '' : 's'}` : null,
                person.activeYears ?? null,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Every tournament, round and motion, read from the tab pages you were already sent.'}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          borderTop: `1px solid ${LEDGER.rule}`,
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
