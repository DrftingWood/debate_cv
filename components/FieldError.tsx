import type { ReactNode } from 'react';

/**
 * An inline field error in the GOV.UK shape: text next to the field, a
 * visually hidden "Error:" prefix so a screen reader announces it as one
 * when focus lands on the field (the field points here through
 * `aria-describedby`), and red plus bold weight so colour is not the only
 * cue (UX-15, AX-2). Render nothing when there is no error, so the id is
 * only referenced while it exists.
 */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-caption font-medium text-destructive">
      <span className="sr-only">Error: </span>
      {children}
    </p>
  );
}

/**
 * The edge of a text field. `border-input` rather than the hairline
 * `border-border`: a hairline is right for a table rule and wrong for the
 * thing you have to find before you can type in it (FORM-5, UX-18; the token
 * itself is raised to 3:1 in the shared-primitives change). No
 * `outline-hidden`: the global `:focus-visible` outline is the visible focus
 * (UX-10). An invalid field turns its edge red as well as getting the text.
 */
export const fieldInputClass =
  'block w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-base text-ink shadow-xs md:text-ui ' +
  'aria-invalid:border-2 aria-invalid:border-destructive';

/** Join describedby ids, dropping the ones whose element is not rendered. */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined.length > 0 ? joined : undefined;
}
