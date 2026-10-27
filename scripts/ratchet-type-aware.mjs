// Pure helpers for the type-aware lint ratchet (used by check-ratchet.mjs and
// covered by tests/ratchetTypeAware.test.ts). No I/O here.

/** Rule ids of a typescript-eslint flat preset (every config's `rules` keys). */
export function presetRuleIds(flatConfigs) {
  const ids = new Set();
  for (const c of flatConfigs) for (const id of Object.keys(c.rules ?? {})) ids.add(id);
  return ids;
}

/**
 * Count warnings and errors per rule id from ESLint's JSON results, keeping
 * only ids in `ruleIds`. Returns a plain object { ruleId: count }.
 */
export function countByRule(eslintResults, ruleIds) {
  const counts = {};
  for (const file of eslintResults) {
    for (const m of file.messages ?? []) {
      if (m.ruleId && ruleIds.has(m.ruleId)) counts[m.ruleId] = (counts[m.ruleId] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Compare counts with the committed baseline. A rule missing from the baseline
 * has baseline 0, so a rule that starts firing for the first time fails.
 * Returns { rows: [{ rule, count, baseline, status }], failed, total, baselineTotal }
 * where status is 'over' | 'under' | 'ok'.
 */
export function compareToBaseline(counts, baseline) {
  const rules = [...new Set([...Object.keys(baseline), ...Object.keys(counts)])].sort();
  const rows = rules.map((rule) => {
    const count = counts[rule] ?? 0;
    const base = baseline[rule] ?? 0;
    return {
      rule,
      count,
      baseline: base,
      status: count > base ? 'over' : count < base ? 'under' : 'ok',
    };
  });
  return {
    rows,
    failed: rows.some((r) => r.status === 'over'),
    total: rows.reduce((n, r) => n + r.count, 0),
    baselineTotal: rows.reduce((n, r) => n + r.baseline, 0),
  };
}
