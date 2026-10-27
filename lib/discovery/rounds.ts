/**
 * The owner's same-round rule for the Found tab: one person cannot be in two
 * places in the same round. Speaking and judging, two teams, or a team and a
 * panel in one round means two people; the same person across different
 * rounds is fine (spoke the prelims, judged an outround; an organiser on
 * several swing teams).
 *
 * Exceptions, also the owner's:
 *  - Two panels in one round is not proof: HWS-style formats seat one judge
 *    on a double panel. Nothing in the schema marks such a format, so it is
 *    "needs your check", never a block.
 *  - EUDC is the only event where one person may be in both the Open and the
 *    ESL outround of the same stage (its ESL teams debate in both brackets).
 *  - Open and Novice finals at one tournament can never be one person; they
 *    run at the same time.
 *
 * Pure. Round labels are compared through `roundKey`, so "R1A" and "Round 1"
 * are one round and a break round is its stage plus its category.
 */

import { roundKey } from '@/lib/identity/affectedTournaments';

/** One place a name occupied in one round. */
export type Slot = {
  /** `roundKey` output: "R3", "semifinal", "final novice". */
  round: string;
  kind: 'speak' | 'judge';
  /** The team, for speaking slots. */
  team?: string | null;
};

export type ClashLevel = 'block' | 'check';

export type Clash = { level: ClashLevel; a: Slot; b: Slot };

type ParsedRound = { prelim: number } | { stage: string; category: string };

function parseRound(key: string): ParsedRound {
  const prelim = /^R(\d+)$/.exec(key);
  if (prelim) return { prelim: Number(prelim[1]) };
  const [stage, ...rest] = key.split(' ');
  // A grand final and a novice final are the same slot in the day.
  return { stage: stage === 'grand_final' ? 'final' : stage, category: rest.join(' ') || 'open' };
}

/** Whether two rounds run at the same time at one tournament. */
function concurrent(x: string, y: string, eudc: boolean): boolean {
  const a = parseRound(x);
  const b = parseRound(y);
  if ('prelim' in a || 'prelim' in b) {
    return 'prelim' in a && 'prelim' in b && a.prelim === b.prelim;
  }
  if (a.stage !== b.stage) return false;
  if (a.category === b.category) return true;
  const pair = new Set([a.category, b.category]);
  return !(eudc && pair.has('open') && pair.has('esl'));
}

/**
 * Whether two slots, held by two different names (or two entries under one
 * name), can belong to one person.
 */
export function slotsClash(a: Slot, b: Slot, eudc: boolean): ClashLevel | null {
  if (!concurrent(a.round, b.round, eudc)) return null;
  if (a.kind === 'judge' && b.kind === 'judge') return 'check';
  return 'block';
}

const LEVEL: Record<ClashLevel, number> = { check: 1, block: 2 };

/** The worst clash between two names' slots at one tournament, if any. */
export function presenceClash(a: readonly Slot[], b: readonly Slot[], eudc: boolean): Clash | null {
  let worst: Clash | null = null;
  for (const x of a) {
    for (const y of b) {
      const level = slotsClash(x, y, eudc);
      if (level && (!worst || LEVEL[level] > LEVEL[worst.level])) worst = { level, a: x, b: y };
    }
  }
  return worst;
}

/**
 * A clash inside ONE name's own slots: the name spoke and judged in one
 * round, or its team sits in two brackets' finals. That is two people merged
 * under one name (option B phase 7 splits them). The owner allows these rows
 * with a visible warning. Two panels in one round is not counted (HWS), and
 * a team's own repeated rows in one round are the same entry.
 */
export function selfClash(slots: readonly Slot[], eudc: boolean): Clash | null {
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.kind === 'judge' && b.kind === 'judge') continue;
      if (a.kind === 'speak' && b.kind === 'speak' && a.round === b.round && a.team === b.team) {
        continue;
      }
      if (slotsClash(a, b, eudc) === 'block') return { level: 'block', a, b };
    }
  }
  return null;
}

/** A speaking slot from a team-results row or a break-round result. */
export function speakSlot(
  label: string | null,
  roundNumber: number | null,
  team: string,
): Slot | null {
  const round = roundKey(label, roundNumber);
  return round ? { round, kind: 'speak', team } : null;
}

/** A judging slot from a JudgeAssignment row. */
export function judgeSlot(stage: string | null, roundNumber: number | null): Slot | null {
  const round = roundKey(stage, roundNumber);
  return round ? { round, kind: 'judge' } : null;
}

/** "round 3", "the novice semifinal", "the grand final". */
export function roundLabel(key: string): string {
  const r = parseRound(key);
  if ('prelim' in r) return `round ${r.prelim}`;
  const [stage, ...rest] = key.split(' ');
  const category = rest.join(' ');
  const name = stage.replace(/_/g, ' ');
  return category ? `the ${category} ${name}` : `the ${name}`;
}

/** "judged" / "spoke in". */
export function slotVerb(slot: Slot): string {
  return slot.kind === 'judge' ? 'judged' : 'spoke in';
}

/** "spoke in round 3" / "judged the final". */
export function slotPhrase(slot: Slot): string {
  return `${slotVerb(slot)} ${roundLabel(slot.round)}`;
}
