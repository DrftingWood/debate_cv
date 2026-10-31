import type { MarkKind } from '@/lib/admin/adminChecks';
import { checkedWords } from '@/lib/audit/checkedLabel';

/**
 * What a row's "Mark checked" cell needs, with nothing private and nothing
 * that is not plain data (it is handed to a client table): the mark to store
 * or undo, who vouched for the row and when (as the sentence the Tournaments
 * page already uses, a name and never an address), and whether the data has
 * changed since a mark that no longer holds.
 */
export type MarkCell = {
  kind: MarkKind;
  subject: string;
  /** What "Mark checked" stores; the server may refine it (reportMarks.ts). */
  fingerprint: string;
  /** "Checked by owner on 31 Oct 2026" while a mark holds; null otherwise. */
  checkedWords: string | null;
  changed: boolean;
};

export function markCell(input: {
  kind: MarkKind;
  subject: string;
  fingerprint: string;
  checked: { by: string; at: Date } | null;
  changed: boolean;
}): MarkCell {
  const { checked, ...rest } = input;
  return { ...rest, checkedWords: checked ? checkedWords(checked.by, checked.at) : null };
}
