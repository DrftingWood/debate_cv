/**
 * A `.catch` for one /admin read: log it and answer null. The tabs read their
 * ledgers side by side, and one failed read must not take the others (or the
 * tab strip) down; the section whose read failed says so in words
 * (components/admin/LoadFailed.tsx).
 */
export const orNull =
  (what: string) =>
  (err: unknown): null => {
    console.error(`admin: ${what} failed to load`, err);
    return null;
  };
