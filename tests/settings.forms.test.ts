import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The component files use the automatic JSX runtime under Next; this runner
// compiles them with the classic one.
(globalThis as { React?: typeof React }).React = React;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/account',
}));
// The sign-out server action pulls in the whole Auth.js config.
vi.mock('@/lib/auth/signOutAction', () => ({ signOutAction: vi.fn() }));

const { DeleteConfirmForm } = await import('@/components/AccountActions');
const { SlugField, slugErrorMessage } = await import('@/components/SharingManager');
const { RemovalConfirm, pendingRemovals } = await import('@/components/IdentityManager');
const { NamePicker, ProgressSteps, ScanEmpty, preflightProgressText } =
  await import('@/components/OnboardingSteps');
const { OnboardingFlow } = await import('@/components/OnboardingFlow');
const { ToastProvider } = await import('@/components/ui/Toast');
const { matchesDeleteConfirmation, deleteConfirmationTarget } =
  await import('@/lib/account/deleteConfirmation');

const h = React.createElement;
const noop = () => {};

function deleteForm(over: Partial<Parameters<typeof DeleteConfirmForm>[0]> = {}) {
  return renderToStaticMarkup(
    h(DeleteConfirmForm, {
      target: 'maya@example.com',
      usesPhrase: false,
      value: '',
      onChange: noop,
      error: null,
      pending: false,
      onSubmit: noop,
      onCancel: noop,
      ...over,
    }),
  );
}

describe('delete-account confirmation (SET-1, SET-2)', () => {
  it('labels the field with a real <label> naming the email, and links the warning', () => {
    const out = deleteForm();
    expect(out).toMatch(
      /<label for="delete-confirm"[^>]*>Type your email address, <strong[^>]*>maya@example.com<\/strong>/,
    );
    expect(out).toContain('id="delete-confirm"');
    expect(out).toContain('aria-describedby="delete-confirm-warning"');
    // The attribute, not the substring: the field's class list carries Tailwind 4's
    // `aria-invalid:border-destructive` variant whether or not the field is invalid.
    expect(out).not.toMatch(/\saria-invalid=/);
    expect(out).toContain('autoCapitalize="none"');
    expect(out).toContain('spellCheck="false"');
    expect(out).not.toContain('placeholder');
  });

  it('keeps the destructive button enabled and a real submit (validated on press)', () => {
    const out = deleteForm();
    const submit =
      out.match(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*<\/button>/)?.[0] ?? '';
    expect(submit).toContain('Permanently delete my account');
    expect(submit).not.toContain('disabled=""');
  });

  it('shows an inline GOV.UK-style error linked to the field', () => {
    const out = deleteForm({ error: 'That does not match. Type maya@example.com exactly' });
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="delete-confirm-warning delete-confirm-error"');
    expect(out).toMatch(
      /<p id="delete-confirm-error"[^>]*><span class="sr-only">Error: <\/span>That does not match/,
    );
  });

  it('asks an account with no email to type DELETE instead', () => {
    const out = deleteForm({ target: 'DELETE', usesPhrase: true });
    expect(out).toContain('Type <strong>DELETE</strong> to confirm');
    expect(out).toContain('aria-describedby="delete-confirm-warning delete-confirm-hint"');
    expect(out).toContain('type="text"');
  });

  it('matches the confirmation the way the server does', () => {
    expect(deleteConfirmationTarget(null)).toBe('DELETE');
    expect(deleteConfirmationTarget('  ')).toBe('DELETE');
    expect(matchesDeleteConfirmation(' Maya@Example.com ', 'maya@example.com')).toBe(true);
    expect(matchesDeleteConfirmation('DELETE', 'maya@example.com')).toBe(false);
    expect(matchesDeleteConfirmation('delete', null)).toBe(true);
    expect(matchesDeleteConfirmation('', null)).toBe(false);
  });
});

describe('public-link address field (SET-4, SET-8)', () => {
  const field = (error: string | null) =>
    renderToStaticMarkup(
      h(SlugField, { value: 'Maya', onChange: noop, error, pending: false, onSubmit: noop }),
    );

  it('is a form with a labelled, non-capitalising field whose hint is linked', () => {
    const out = field(null);
    expect(out.startsWith('<form')).toBe(true);
    expect(out).toContain('<label for="custom-slug"');
    expect(out).toContain('Custom address after /u/ (optional)');
    expect(out).toContain('aria-describedby="custom-slug-hint"');
    expect(out).toContain('autoCapitalize="none"');
    expect(out).toContain('type="submit"');
    expect(out.match(/<input[^>]*>/)?.[0]).not.toContain('outline-none');
    expect(out).toContain('border-input');
  });

  it('puts a refusal next to the field instead of in a toast', () => {
    const out = field(slugErrorMessage('slug_taken', 'Maya-Rao'));
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="custom-slug-hint custom-slug-error"');
    expect(out).toContain('That address is taken. Try maya-rao-2');
  });

  it('turns every API code into words', () => {
    for (const code of ['too_short', 'too_long', 'invalid_chars', 'reserved', 'slug_taken']) {
      const message = slugErrorMessage(code, 'x');
      expect(message).not.toBe(code);
      expect(message).not.toContain('_');
    }
  });
});

describe('identity removal confirmation (SET-6)', () => {
  const names = [
    { displayName: 'Maya Rao', normalizedName: 'maya rao', urlCount: 3, isMine: true },
    { displayName: 'M Rao', normalizedName: 'm rao', urlCount: 2, isMine: true },
    { displayName: 'Mia Roe', normalizedName: 'mia roe', urlCount: 1, isMine: false },
  ];

  it('counts what unticking would take off the record', () => {
    expect(pendingRemovals(names, new Set(['maya rao', 'm rao'])).removed).toHaveLength(0);
    const one = pendingRemovals(names, new Set(['maya rao']));
    expect(one.removed.map((n) => n.displayName)).toEqual(['M Rao']);
    expect(one.links).toBe(2);
    expect(one.removesEverything).toBe(false);
    expect(pendingRemovals(names, new Set()).removesEverything).toBe(true);
  });

  it('warns that unticking everything empties the record', () => {
    const out = renderToStaticMarkup(
      h(RemovalConfirm, {
        removal: pendingRemovals(names, new Set()),
        pending: false,
        onConfirm: noop,
        onKeep: noop,
      }),
    );
    expect(out).toContain('This removes every name, so your Record will be empty.');
    expect(out).toContain('Maya Rao, M Rao: the tournaments on 5 links leave');
    expect(out).toContain('Keep them');
  });
});

describe('onboarding steps (FORM-1 to FORM-4)', () => {
  it('marks the step list up as progress', () => {
    const out = renderToStaticMarkup(h(ProgressSteps, { phase: 'pick' }));
    expect(out).toContain('aria-label="Setup progress"');
    expect(out).toMatch(/<li aria-current="step"[^>]*>.*Pick yourself/);
    expect(out.match(/\(completed\)/g)).toHaveLength(2);
  });

  it('gives an empty scan three ways forward', () => {
    const out = renderToStaticMarkup(
      h(ScanEmpty, { scanned: 120, scanning: false, onScanAgain: noop }),
    );
    expect(out).toContain('No tournament links found in this Gmail account (120 emails checked).');
    expect(out).toContain('href="/dashboard"');
    expect(out).toContain('Scan again');
    expect(out).toContain('Sign out');
  });

  it('words the read step as plain progress', () => {
    expect(preflightProgressText({ extracted: 10, failed: 2, remaining: 28 })).toBe(
      '12 of 40 tournament links read',
    );
  });
});

describe('onboarding flow render (FORM-1, FORM-4, FORM-10, COPY-4)', () => {
  const flow = (initialPhase: 'scan' | 'preflight' | 'pick') =>
    renderToStaticMarkup(
      h(
        ToastProvider,
        null,
        h(OnboardingFlow, { initialPhase, initialUrlCount: 4, initialPreflightRemaining: 4 }),
      ),
    );

  it('gives each step a focusable heading and states the privacy facts', () => {
    const out = flow('scan');
    expect(out).toMatch(/<h2 tabindex="-1"[^>]*>Scan your Gmail for tournament links<\/h2>/i);
    expect(out).toContain('email bodies never stored');
    expect(out).not.toMatch(/preflight|landing page/i);
  });

  it('shows a live progress line on the read step, not live counters', () => {
    const out = flow('preflight');
    expect(out).toContain('Reading your tournament links');
    expect(out).toContain('role="status"');
    // Live regions are the toast host's role="alert"/role="status" pair (T1,
    // no aria-live attribute) plus the progress line: two statuses, one alert;
    // the counters themselves are not live.
    expect(out).not.toContain('aria-live');
    expect(out.match(/role="status"/g)).toHaveLength(2);
    expect(out.match(/role="alert"/g)).toHaveLength(1);
  });

  it('shows loading, not "no names", before the names arrive (FORM-10)', () => {
    const out = flow('pick');
    expect(out).toContain('Loading names');
    expect(out).not.toContain('No names could be read');
  });

  it('keeps the closeness badges and puts the pick error inside the named group', () => {
    const out = renderToStaticMarkup(
      h(NamePicker, {
        names: [
          {
            displayName: 'Maya Rao',
            normalizedName: 'maya rao',
            urlCount: 2,
            isMine: false,
            proximity: 'match' as const,
          },
          {
            displayName: 'M. Rao',
            normalizedName: 'm rao',
            urlCount: 1,
            isMine: false,
            proximity: 'close' as const,
          },
          {
            displayName: 'Sam Lee',
            normalizedName: 'sam lee',
            urlCount: 1,
            isMine: false,
            proximity: 'different' as const,
          },
        ],
        selected: new Set<string>(),
        error: 'Tick at least one name that is you',
        onToggle: noop,
      }),
    );
    expect(out).toContain('<fieldset aria-describedby="onboarding-names-error"');
    expect(out).toContain('<legend class="sr-only">Names that are you</legend>');
    expect(out).toContain('Error: </span>Tick at least one name that is you');
    expect(out).toContain('Close to your Google name');
    expect(out).toContain('Not like your Google name');
    expect(out).toContain('accent-primary');
  });
});
