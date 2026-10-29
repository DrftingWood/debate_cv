export type SharableTournament = { id: string; name: string; year: number | null };

/**
 * Settings -> Public sharing: which tournaments the public CV shows (C101).
 * One checkbox per tournament on the record, checked = shown. Unchecking
 * hides it from /u/<slug> and its share image; the owner's own /cv is
 * unaffected. Stateless so it can be server-rendered in a test.
 */
export function PublicTournamentVisibility({
  tournaments,
  hiddenIds,
  onToggle,
  disabled,
}: {
  tournaments: SharableTournament[];
  hiddenIds: string[];
  onToggle: (id: string, shown: boolean) => void;
  disabled?: boolean;
}) {
  if (tournaments.length === 0) return null;
  const hidden = new Set(hiddenIds);
  return (
    <fieldset className="space-y-2 border-t border-border pt-3" disabled={disabled}>
      <legend className="text-table font-medium text-ink">Tournaments shown publicly</legend>
      <p className="text-caption text-ink-soft">Hidden tournaments still show on your own CV.</p>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {tournaments.map((t) => {
          const id = `pub-t-${t.id}`;
          return (
            <li key={t.id}>
              <label htmlFor={id} className="flex items-center gap-2 text-table text-ink">
                <input
                  id={id}
                  type="checkbox"
                  className="h-6 w-6 shrink-0 accent-primary"
                  checked={!hidden.has(t.id)}
                  onChange={(e) => onToggle(t.id, e.currentTarget.checked)}
                />
                <span>
                  {t.name}
                  {t.year ? <span className="text-ink-soft"> · {t.year}</span> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
