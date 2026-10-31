import { describe, expect, it } from 'vitest';
import {
  bulkMarkPayload,
  flagItemsOf,
  markedWords,
  MARK_BATCH_MAX,
  undoOutcome,
  undoTargets,
} from '@/lib/admin/inboxActions';
import { KIND_LABEL, kindsParam, parseKinds } from '@/lib/admin/inboxTypes';

// The Inbox table's pure decisions: what a bulk mark sends, what Undo takes
// back, which flags "Review later" files, and the ?kinds= words.

const mark = (subject: string) => ({
  kind: 'check' as const,
  subject,
  fingerprint: 'a'.repeat(16),
});
const row = (key: string, n: number) => ({
  key,
  markItems: Array.from({ length: n }, (_, i) => mark(`${key}:${i}`)),
  flagItems: [],
});

describe('bulkMarkPayload', () => {
  it('sends every mark of the ticked rows, in list order, and nothing of the others', () => {
    const rows = [row('a', 2), row('b', 1), row('c', 3)];
    const out = bulkMarkPayload(rows, new Set(['c', 'a']));
    expect(out.items.map((i) => i.subject)).toEqual(['a:0', 'a:1', 'c:0', 'c:1', 'c:2']);
    expect(out.keys).toEqual(['a', 'c']);
    expect(out.left).toBe(0);
  });

  it('keeps a row whole: one that would pass the route cap waits, with every row after it', () => {
    const rows = [row('a', MARK_BATCH_MAX - 1), row('b', 2), row('c', 1)];
    const out = bulkMarkPayload(rows, new Set(['a', 'b', 'c']));
    expect(out.items).toHaveLength(MARK_BATCH_MAX - 1);
    expect(out.keys).toEqual(['a']);
    expect(out.left).toBe(2);
  });

  it('is empty when nothing is ticked', () => {
    expect(bulkMarkPayload([row('a', 1)], new Set())).toEqual({ items: [], keys: [], left: 0 });
  });
});

describe('undoTargets', () => {
  it('drops the fingerprint: DELETE names the mark by kind and subject', () => {
    expect(undoTargets([mark('1:x')])).toEqual([{ kind: 'check', subject: '1:x' }]);
  });
});

describe('flagItemsOf', () => {
  it('collects the ticked rows flags once each', () => {
    const f = (id: string) => ({ source: 'import' as const, sourceId: id });
    const rows = [
      { key: 'a', flagItems: [f('j1'), f('j2')] },
      { key: 'b', flagItems: [f('j2')] },
      { key: 'c', flagItems: [f('j3')] },
    ];
    expect(flagItemsOf(rows, new Set(['a', 'b'])).map((x) => x.sourceId)).toEqual(['j1', 'j2']);
  });
});

describe('markedWords', () => {
  it('says so when fewer checks counted than were sent', () => {
    expect(markedWords(3, 2)).toContain('2 of 3');
    expect(markedWords(3, 3)).not.toContain('of');
    expect(markedWords(0, 0)).not.toContain('of');
  });
});

describe('?kinds=', () => {
  it('reads the kinds named, in the inbox order, dropping unknown words and repeats', () => {
    expect(parseKinds('import,check,check,nonsense')).toEqual(['check', 'import']);
  });
  it('treats none, junk or all four as no filter', () => {
    expect(parseKinds(undefined)).toEqual([]);
    expect(parseKinds('zzz')).toEqual([]);
    expect(parseKinds('check,report,import,parser')).toEqual([]);
  });
  it('writes the kinds back the way it reads them', () => {
    expect(kindsParam(parseKinds('import,check'))).toBe('check,import');
    expect(KIND_LABEL.check).toBe('Accuracy');
  });
});

describe('undoOutcome', () => {
  it('says the mark is undone when every DELETE worked', () => {
    expect(undoOutcome(3, 0, null)).toEqual({
      kind: 'success',
      title: 'Mark undone',
      description: 'It is back in the Inbox.',
    });
  });

  it('says how many were undone and that the rest are still checked on a partial failure', () => {
    const out = undoOutcome(3, 1, 'Something went wrong on our side.');
    expect(out.kind).toBe('error');
    expect(out.title).toBe('Undid 2 of 3; the rest are still checked');
    expect(out.description).toContain('Something went wrong on our side.');
  });

  it('says undo failed when none worked', () => {
    const out = undoOutcome(2, 2, 'Network down.');
    expect(out.kind).toBe('error');
    expect(out.title).toBe('Undo failed');
    expect(out.description).toContain('Network down.');
  });
});
