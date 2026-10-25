/**
 * What still needs a tag answer — one definition, used by the classifier and
 * by the export that hands the same list to a human (or to Claude) to answer.
 *
 * Filing a suggestion does NOT change Motion.motionType / topic or
 * Tournament.region — only approval does — so "untagged" alone would keep
 * returning items that already have an answer waiting. A dimension that
 * already has any proposal (pending, or rejected by the admin) is left alone:
 * pending is already an answer, and a rejected one must not be revived.
 */
export const MOTIONS_TODO = {
  OR: [
    { motionType: null, tagProposals: { none: { kind: 'motion_type' } } },
    { topic: null, tagProposals: { none: { kind: 'motion_topic' } } },
  ],
};

export const TOURNAMENTS_TODO = { region: null, tagProposals: { none: { kind: 'region' } } };

/** The tournament's host ("wudc2022.calicotab.com"), which often names the place. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
