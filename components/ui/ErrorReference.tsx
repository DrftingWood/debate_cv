/**
 * The line an error boundary shows instead of the raw message (UX-26).
 * `digest` is the hash Next attaches to a server error and the key Sentry
 * files it under, so it is the one thing worth asking a user to quote. A
 * client-side throw has none, and then nothing is shown rather than an
 * empty "Reference:".
 */
export function ErrorReference({ digest }: { digest?: string }) {
  if (!digest) return null;
  return (
    <p className="mt-3 text-caption text-ink-soft">
      Reference: <span className="font-mono">{digest}</span>
    </p>
  );
}
