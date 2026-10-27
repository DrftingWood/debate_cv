/**
 * The report dialog's two message rules (components/CvRowReportButton.tsx).
 * Both used to be invisible: Send was silently disabled until the form was
 * valid (FORM-7), and a failed send put the server's raw error code in a
 * toast outside the aria-modal dialog (FORM-12, DASH-5). The dialog itself
 * needs a DOM to open, so the rules are pinned here and the trigger's
 * accessible name in cv.recordPage.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';

(globalThis as { React?: typeof React }).React = React;

const { reportValidationError, reportFailureMessage, MIN_COMMENT_CHARS } =
  await import('@/components/CvRowReportButton');

describe('reportValidationError', () => {
  it('passes with a ticked category and no comment', () => {
    expect(reportValidationError(1, '')).toBeNull();
  });

  it('passes with a long enough comment and no category', () => {
    expect(reportValidationError(0, 'x'.repeat(MIN_COMMENT_CHARS))).toBeNull();
  });

  it('explains the rule when neither is given, counting trimmed text only', () => {
    const msg = reportValidationError(0, `  ${'x'.repeat(MIN_COMMENT_CHARS - 1)}   `);
    expect(msg).toBe(
      `Tick at least one problem, or describe it in ${MIN_COMMENT_CHARS} characters or more.`,
    );
  });
});

describe('reportFailureMessage', () => {
  it('never echoes a server error code', () => {
    for (const status of [0, 400, 401, 429, 500, 502]) {
      const msg = reportFailureMessage(status);
      expect(msg).not.toMatch(/bad_request|no_accessible|unauthorized|HTTP|_/);
      expect(msg.endsWith('.')).toBe(true);
    }
  });

  it('tells a rate-limited user to wait and a signed-out user to sign in', () => {
    expect(reportFailureMessage(429)).toMatch(/Try again later/);
    expect(reportFailureMessage(401)).toMatch(/Sign in again/);
    expect(reportFailureMessage(0)).toMatch(/connection/);
  });
});
