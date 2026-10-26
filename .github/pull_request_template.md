## What and why

<!-- One concern per PR. What changes for a user or an operator, and why now. -->

## Checks run locally

<!-- Tick what you ran. Name anything you could not run and why (AI-3). -->

- [ ] `npm run typecheck`
- [ ] `npm run lint` (no new errors; warnings not above the baseline)
- [ ] `npm test`
- [ ] `npm run ratchet` (a raised baseline is explained below)
- [ ] `npx next build`

## Review questions (`docs/CODING_STANDARDS.md`)

- [ ] One concern, under about 400 changed lines excluding lockfile and fixtures; no refactor mixed with a behaviour change (GP-1)
- [ ] Logic changes come with a test; a refactor changes no characterization test's expected values (TQ-1, TQ-2)
- [ ] New input is parsed with zod; new routes check auth themselves (TE-1, SE-3)
- [ ] No token, connection string or private tournament URL in logs, fixtures, snapshots or this PR text (SE-1)
- [ ] Raw SQL is tagged-template; raw `UPDATE`s set `"updatedAt"`; lock order unchanged or the deadlock tests were re-run (DB-2 to DB-4)
- [ ] Searched for an existing helper before adding one (AI-1)
- [ ] `PARSER_VERSION` untouched, or the reason it had to change is written in `lib/calicotab/version.ts` (AI-2)
- [ ] Any new dependency is named here with why it is needed, and pinned (DP-2)
- [ ] UI changes: real tables, colour never the only cue, keyboard reachable (AX-1 to AX-3; `docs/DESIGN_INSTRUCTIONS.md` §13)
- [ ] Commit and PR attribution lines present (GP-2)

## Not merging

<!-- Agents: leave this line. The owner merges. -->
Merge is the owner's decision (AI-4).
