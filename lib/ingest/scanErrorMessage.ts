/**
 * What to tell the user when a Gmail scan is refused.
 *
 * The scan route allows one scan per user every two minutes (and twelve an
 * hour), and opening the CV page starts a background scan of its own, so a
 * click on "Scan Gmail" shortly afterwards is refused with status 429 and the
 * bare code "rate_limited". That is a harmless wait, not a failure, and the
 * bare code reads like one. Everything else is passed through unchanged.
 */
export function scanErrorMessage(status: number, error: string): string {
  if (status === 429 || error === 'rate_limited') {
    return 'Your mailbox was scanned a moment ago. Scans are limited to one every 2 minutes (opening your CV also scans). Nothing is wrong; try again shortly.';
  }
  return error;
}
