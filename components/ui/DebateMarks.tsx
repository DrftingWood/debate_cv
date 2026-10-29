import type { ReactNode, SVGProps } from 'react';

/*
 * Debate marks: the glyphs no icon library has, drawn to match Phosphor.
 *
 * Phosphor draws on a 256-unit grid with round caps and joins; its Regular
 * weight is a 16-unit stroke and Light a 12-unit one. These use the same
 * grid, stroke and `1em` default size, so a mark sits beside a Phosphor icon
 * without looking borrowed. Like the library icons they are decorative: the
 * label next to them carries the meaning (label-first policy, redesign
 * 2026-10-29), so call sites pass `aria-hidden`.
 *
 * Drawn and checked at 14, 16, 20 and 40px beside Phosphor glyphs. Rising
 * stage bars were tried for Break first and read as a phone signal meter,
 * so Break is a knockout bracket (two entries joining into one) and
 * Champion the same bracket ending in a filled winner's dot: fill means
 * "won" here and nowhere else. A source tab is Phosphor's `Table`, a
 * starred speaker finish its `Star`, a chair its `Chair`, a motion its
 * `Quotes`; only the ideas no library draws are here.
 *
 * Marks still to draw when their pages are built: panel, partner, info slide.
 */

type MarkProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Regular at 16px and below, Light at 20px and above (same rule as Phosphor). */
  weight?: 'light' | 'regular';
  size?: number | string;
};

function Mark({
  weight = 'regular',
  size = '1em',
  children,
  ...rest
}: MarkProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight === 'light' ? 12 : 16}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Broke: reached the outrounds. */
export function BreakMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M48 64H128V192H48M128 128H216" />
    </Mark>
  );
}

/** Won a final (Open, a category, or a gold final). */
export function ChampionMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M48 64H128V192H48M128 128H164" />
      <circle cx="192" cy="128" r="28" fill="currentColor" />
    </Mark>
  );
}

/** A major (the ◆ that marks majors in the charts and Highlights). */
export function MajorMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M128 40L216 128L128 216L40 128Z" />
      <path d="M128 92L164 128L128 164L92 128Z" fill="currentColor" />
    </Mark>
  );
}

/** Speaker-tab figures: rank and average (a lectern, not a microphone). */
export function SpeakerMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="128" cy="56" r="24" />
      <path d="M40 112H216M64 112L84 216H172L192 112" />
    </Mark>
  );
}

/** Adjudication core: CA, DCA or core (the inner circle). */
export function CoreMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="128" cy="128" r="88" />
      <circle cx="128" cy="128" r="28" fill="currentColor" />
    </Mark>
  );
}
