# Discovery tab: find a user's appearances in the pre-scrape (design)

Status: **phase 1 built** (read-only list behind a flag, branch `feat/discovery-found-phase1`; the migration awaits the owner's approval before merge). Phases 2-5 not started. The owner's answers to section 9 are in section 10; where they differ from the text above, section 10 wins.
Builds on: option B (`2026-10-27-person-identity-option-b-design.md`), B9 (`2026-10-25-b9-prescrape-design.md`), owner answers of 2026-10-27 (close names always need a tick; double surnames and one-word names always go to the user; same-round rule; EUDC, Open/Novice and HWS rules).

## 1. What exists today (checked in code at `ed66d05`)

| Claim in the brief | Verdict | Evidence |
| --- | --- | --- |
| The CV only includes tournaments with an ingested private URL | **True** | `lib/cv/buildCvData.ts:368-389` loads the user's `DiscoveredUrl` rows with `tournamentId` and `ingestedAt` set; `:392-396` derives `tournamentIds` from them alone; `:445-450` reads participations only inside that set; judge rows likewise (`:622-628`). A pre-scraped tournament has no `DiscoveredUrl` for the user, so it can never appear. |
| A claim needs attendance at an ingested tournament | **True, but looser than "ingested"** | `app/api/persons/[id]/claim/route.ts:57-71` needs a `DiscoveredUrl` for the tournament; it does not check `ingestedAt`. Identity uses the loose `personNameMatches` (`:109`) against registration names **or the Google name** (`:101-107`). |
| Participants search only works inside ingested tournaments | **True, same nuance** | `app/api/tournaments/[id]/participants/route.ts:90-96` returns 403 without a `DiscoveredUrl` for that tournament (any status). |

Other facts that shape the design:

- **Option B is not built.** No `UserNameAlias`, `claimSource`, `listedName` or `matchKey` anywhere in `prisma/` or `lib/`. Claims still live on `Person.claimedByUserId` (`prisma/schema.prisma:275`).
- **Onboarding confirm accepts any 50 names** (`app/api/onboarding/confirm/route.ts:11-13`) and claims each by key (`:64-86`). Nothing checks that a name came from the user's own URLs. So "names the user has claimed" is **not** a safe anchor for discovery; only registration names on the user's own private URLs are.
- **`PersonRejection` has no writer** (`schema.prisma:306-316`; only `app/api/admin/clear-data/route.ts:77` deletes it). There is no `persons/[id]/reject` route despite `CLAUDE.md` listing one.
- **Participation ids are not stable** for unclaimed people: every refresh deletes participations whose Person is unclaimed (`lib/calicotab/ingest.ts:2020-2028`) and rewrites them. A "not me" decision keyed on a participation id would vanish on the next re-scrape.
- **Institutions are parsed but not stored.** `TournamentParticipant` has no institution column (`schema.prisma:318-352`); only `teamName` is kept. The pre-scrape empties the registration card (`ingest.ts:274`).
- **Per-round data exists for the same-round rule:** `SpeakerRoundScore` per participation, `TeamResult` per team and round, and `JudgeAssignment.roundNumber`/`stage` for every judge on pre-scraped tournaments (`ingest.ts:335`, `source='round_results'`).
- **Tournament dates are not stored** (only `Tournament.year`, `schema.prisma:223`), so "two places on one weekend" cannot be used as evidence.
- **Only the Gmail scan writes `DiscoveredUrl`** (`lib/gmail/scanUser.ts:52`; ingest only `updateMany`s it). A paste-only user may have no anchor names at all (register item I39, still unverified).
- Matchers: `nameProximity` (`lib/identity/nameProximity.ts:69-90`, match/close/different, accent-folding, one-word names always `different` unless equal) and the looser within-tournament `personNameMatches` (`lib/calicotab/personMatch.ts:92-110`). Round comparison: `roundKey` (`lib/identity/affectedTournaments.ts:340`) treats R1A/R1B as one round and an outround as stage plus category.
- Nav: header holds five items with Admin last (`app/(app)/layout.tsx:122-131`, UX-45 caps it at five); `CvSubNav` holds Record, Statistics, Motions, Tags, Verify (`components/CvSubNav.tsx:6-14`).
- Rate limits exist per route (`lib/rateLimit.ts:37,51`); suppression masks names via `displayNameFor` (`lib/privacy/suppression.ts`).

## 2. Data model

### 2.1 Needed on top of option B

Option B phases 2-4 (participation claims, `UserNameAlias`, read switch) are a hard prerequisite for **adding** rows to the CV: a discovered appearance becomes a participation claim with `claimSource='discovery'`, and `buildCvData`'s tournament set becomes "URL tournaments ∪ tournaments with a claimed participation".

Two additions:

```prisma
model UserNameAlias {            // option B, plus one column
  // … as in option B 3.1 …
  /// The DiscoveredUrl whose registration name this alias was taken from.
  /// Null = not anchored (typed, or Google name): never used for discovery.
  anchorUrlId String?
}

/// One row per (user, appearance) the matcher has shown. Keyed on
/// (tournamentId, personId), not the participation id, because a refresh
/// deletes and rewrites unclaimed participations (ingest.ts:2020-2028).
model AppearanceCandidate {
  id           BigInt   @id @default(autoincrement())
  userId       String
  tournamentId BigInt
  personId     BigInt
  status       String   // candidate | confirmed | rejected | blocked | withdrawn
  blockReason  String?  // conflict_same_round | claimed_by_other | suppressed | merged_namesake
  proximity    String   // match | close | ambiguous (one-word, double surname)
  score        Int      // ranking only; never a gate on its own
  evidence     Json     // the lines shown under "Why this match"
  aliasId      String?
  matcherVersion Int
  decidedAt    DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([userId, tournamentId, personId])
  @@index([userId, status])
}
```

Rejections persist because the key survives re-scrapes. `withdrawn` is a user undo after confirm. When phase 7 of option B splits same-name rows inside a tournament, the key needs a third part (role family or entry key); `matcherVersion` lets that migration re-derive rows.

### 2.2 Minimal subset that can ship first

`AppearanceCandidate` alone, anchored on `DiscoveredUrl.registrationName` (ingested URLs only), with no write to any claim. That is a list with persisted "Not me" and "This is me" decisions, read by nothing else. Migration risk: one new table, no change to existing rows, rollback is dropping it. Recorded "This is me" decisions are re-validated, not trusted, when phase 3 turns them into claims.

## 3. Matching

### 3.1 Anchors

Anchor names = distinct `registrationName` on the user's `DiscoveredUrl` rows with `ingestedAt` set, where the user has claimed that name (phase 1: Person claimed by the user; after option B: alias with `anchorUrlId`). **Not** the Google profile name (user-editable free text) and **not** typed or onboarding-only names (section 1). Stand-ins (`isPlaceholderPersonName`) are never anchors.

### 3.2 Candidate generation

1. Exact: `Person.normalizedName` (v1, unique index) and, after option B phase 3, `Person.matchKey` (v2) equal to an anchor's key.
2. Close: `nameProximity(anchor, person.displayName)` over a surname-blocked set (Persons whose first or last token is within one edit of the anchor's surname). Computed in JS; 56k+ names is about 2 MB.
3. Ambiguous: anchors or names with one word, or three or more words where the surname could be either of the last two (double surnames: "Ana García López" vs "Ana García" is `different` today, I38). These are surfaced with `proximity='ambiguous'` and never bulk-confirmable.
4. Keep only participations at tournaments **without** a `DiscoveredUrl` for this user (the ingested ones already go through onboarding), Person not suppressed, not a stand-in, not redacted.

Nothing is ever added automatically, including exact matches.

### 3.3 Hard blocks (shown, not confirmable)

- **Same round, two places.** Against the user's confirmed participations at the **same** tournament: a speaker score or team result in round N while the candidate judged round N (or the reverse), two teams in round N, or two panels in round N. Rounds compared with `roundKey`. Disjoint rounds are allowed (speaker then outround judge; organiser on swing teams).
- **Exceptions:** HWS-style double panels (one debate, two panels) are not a conflict; until a tournament can be marked as such, a two-panel clash on one round is downgraded to "needs your check", not blocked. EUDC only: Open and ESL outrounds may both belong to one person.
- **Open and Novice finals** at one tournament on one participation means two people merged: block with `merged_namesake`.
- **Known merged namesakes** (before option B phase 7): the participation's Person has a speaker score and a judge seat in the same round at that tournament, or the tournament is on the identity checker's overlap list for that key (`scripts/find-identity-affected-tournaments.mjs`; 139 of 855 tournaments in the last run). Confirming would credit another person's scores. Block until phase 7.
- Participation already claimed by another user (after option B): `claimed_by_other`, with "Report a problem".
- Swing and stand-in names: excluded, per the owner (usually irrelevant).

### 3.4 Ranking (orders the list, never adds)

| Evidence | Weight | Source |
| --- | --- | --- |
| Name: `match` 40, `close` 15, `ambiguous` 5 | name | 3.2 |
| A teammate at the candidate was the user's teammate at a confirmed tournament | +30 each, cap 2 | same `teamName` at both, matched by Person id |
| A co-participant (teammate or co-panellist) appears in the user's confirmed tournaments | +10, cap 3 | `TournamentParticipant`, `JudgeAssignment` |
| Team-name institution token matches the user's confirmed team names ("Oxford A" → "oxford") | +15 | heuristic; institution is not stored |
| Region equals a region of the user's confirmed tournaments | +5 | `Tournament.region` (52 tournaments untagged) |
| Year within the user's confirmed span ±2 | +5; outside by 5+ years −15 | `Tournament.year` |
| Common name: the Person bucket appears at more than 4 tournaments in one year, or in 3+ regions | −20 and no bulk | bucket counts |

Tiers: **Strong** = name `match`, no block, and at least one teammate or co-participant overlap. **Possible** = any other unblocked candidate with name `match` or `close`. **Weak** = ambiguous or score below 30, collapsed under "Show N more". Only Strong can be bulk-confirmed.

**False positives at scale.** 52,114 names over 121,376 participations (`docs/SIZING-2026-10-25.md:11`) is 2.3 per name, so for a common name most appearances belong to someone else. The common-name rule, the no-bulk rule and the co-participant evidence carry the load; a bare exact match on a common name lands in Possible, never Strong.

**Accents and scripts.** Use v2 folding (`José` = `Jose`) for matching, but show the name exactly as the tab lists it. Fully non-Latin names have no Person before option B phase 7 (empty v1 key), so they cannot be discovered; the empty state says so honestly when the anchor itself folds to empty. Non-Latin against a Latin transliteration stays `different`.

## 4. UX

- **Where:** a CvSubNav item after Motions, `/cv/found`, label **"Found"** (open question 7). Not the header: it is full at five (UX-45) and Record already appears twice (UX-48). The Record page shows a one-line notice when there are undecided Strong or Possible rows: "3 more tournaments may be yours. Review them", linking to the tab.
- **Page:** `h1` "Tournaments that may be yours". Intro: "These come from public tabs we have stored. We found your name on them, but we have not checked that they are you. Add only the ones you were at."
- **One primary action:** "Add all 4 strong matches" opens a dialog that lists them (UX-6, UX-17), only when the Strong tier is not empty. Every row has outline buttons "Add WUDC 2024 to my record" and "Not me" (named for the row, UX-11, never on hover only, UX-36).
- **Row content** (`DataTable`, tournament as row header `th scope="row"`, UX-28): tournament and year, linked to its public tab (new tab marked, UX-43); role and team or panel; the name as listed; a visible **Why this match** line, e.g. "Same name · your teammate Priya Rao (SIDO 2025) is on this team · South Asia, 2024". Blocked rows explain why in words ("This name judged round 3, the same round you spoke in. It is someone else.").
- **Undo:** after an action the row stays in place with "Added. Undo" or "Hidden. Undo" (inline, not a toast, UX-20), announced in the page's one polite live region (UX-19); focus moves to the next row (UX-7). Below, collapsed sections "Added from public tabs" (with "Remove from record") and "Not me" (with "Show again") make every decision reversible later.
- **States (UX-24):** no anchor names ("We search using the name on your private URLs. Import one first", link to Imports); zero matches ("Your names do not appear on any of the N other tabs we store"); all reviewed; still computing ("Checking 1,240 tournaments…").
- **Mobile:** below `md` each row is a card; actions stack full width at 44 px (UX-8, UX-30).
- **On the CV:** added rows carry a small source mark, "Added from public tab", and the verify page lists them separately.

## 5. Privacy and abuse

The threat: a user takes someone else's name to put that person's record on their own CV.

1. **Private-URL-anchored aliases only** (3.1). To discover "Jane Doe", the user needs an ingested private URL whose registration card says Jane Doe. A forwarded teammate's URL is the residual hole: an anchor whose `nameProximity` to every other anchor and to the Google name is `different` is **disabled for discovery** until an admin approves it.
2. **Evidence thresholds:** bulk only for Strong; blocks in 3.3.
3. **Rate limits:** new `discovery:decide` 100 per day per user; at most 5 anchors per user without admin review.
4. **Admin:** suppress (existing, per name) removes candidates and refuses claims; a new admin action releases all `discovery` claims for one user.
5. **Masking:** every name shown goes through `displayNameFor`; suppressed people are never candidates and are masked in evidence lines.
6. **Sources on every row:** a link to the public tab page the appearance came from.
7. **Disputes:** a private-URL claim outranks a discovery claim. When someone else's private URL ingest names a participation that was claimed via discovery, the discovery claim is released, its owner gets a bell notification, and the candidate becomes `claimed_by_other`. Two discovery claims on one participation: first wins, the second sees `claimed_by_other` and can file a report (existing `CvErrorReport`).
8. **Consent change.** B9 promised "without a private URL, nothing is claimed" (`2026-10-25-b9-prescrape-design.md`, Consent). Discovery breaks that on purpose; the privacy page and the B9 note need a line. The account export gains the candidate decisions.

## 6. Performance and when it runs

- One run per user: load anchors (≤5), fetch the exact keys by index, the surname-blocked set (a scan of about 56k short rows, estimated tens of milliseconds), then one batched query for teammates, panels and rounds at the candidate tournaments. Expected well under 2 s; **not measured**.
- **When:** on demand when the Found tab or the Record notice renders and the stored run is stale (anchor set changed, or the newest `Tournament.updatedAt` is later than the user's last run); after each of the user's private URL ingests completes. No nightly job at today's scale (the daily cron is the only guaranteed one). If the scan exceeds 200 ms, add a `pg_trgm` index or a stored surname key.
- Write only changed candidate rows; never touch rows with a decision except to set `blocked`.

## 7. Phases (each shippable)

| # | Ships | Depends on | Tests |
| --- | --- | --- | --- |
| 1 | `AppearanceCandidate` table; matcher (anchors, exact + close, blocks, ranking) as a pure module; `/cv/found` read-only list with "This is me" and "Not me" recorded, behind flag `DISCOVERY_LIST` (owner and opted-in users first) | nothing | Pure matcher fixtures: exact, close, initial, accent, one-word, double surname, common-name penalty, same-round block, disjoint rounds allowed, EUDC Open+ESL, Open+Novice block, HWS downgrade. API: anchors only from ingested URLs (onboarding-typed names ignored), Google name ignored, decisions survive a simulated re-scrape (participation id changes). UI: axe smoke on `/cv/found`, empty states. Measure precision by hand on the owner's record. |
| 2 | Option B phases 1-4 | own spec | As in option B section 6 |
| 3 | "Add to my record": confirm writes a participation claim `claimSource='discovery'`; `buildCvData` reads the union; source mark on CV; undo and remove; refresh-delete guard for claimed participations (option B phase 3) | 1, 2 | Two users with one name each add their own appearance; a re-scrape keeps a discovery claim; CV, stats, public CV and exports include the row; undo removes it everywhere; rate limit; blocked rows refuse confirm with 409. |
| 4 | Bulk confirm for Strong; dispute rule (private URL outranks discovery) with notification; admin release; privacy copy and export | 3 | Dispute test; bulk dialog lists rows; export schema bump. |
| 5 | After option B phase 7: unblock `merged_namesake` rows; add role family to the key | option B phase 7 | Re-derivation migration on fixtures. |

## 8. Risks and what I could not verify

- **Not run against data.** Candidate counts, precision and query time are estimates; the production database and pre-scrape load were not touched.
- **Merged namesakes** are the largest correctness risk until option B phase 7; the DB alone cannot detect two speakers merged into one row (their scores were overwritten), so the block relies on the checker's offline list.
- **Team name as institution** is a heuristic; many team names are not institutions.
- **Paste-only users** may have no `DiscoveredUrl` and so no anchors (I39).
- **HWS detection:** nothing in the schema marks a double-panel format.
- `buildCvData` orders seasons by the user's email date (`:403-427`); discovered tournaments have none, so they sort by year only.

## 9. Open questions for the owner

1. **May a tournament the user has no private URL for appear on their CV at all?** This reverses B9's consent line. Recommended: **yes, with a "Added from public tab" mark**, because the data is already public and the user confirms each row.
2. **Ship phase 1 (list only, no add) before option B?** Recommended: **yes, behind a flag for you first**, so matching quality is checked on real records before anything reaches a CV.
3. **Which names may seed discovery?** Recommended: **only registration names from the user's own ingested private URLs**; not the Google name or typed names, which anyone can set.
4. **Should added rows show on the public CV?** Recommended: **yes, with the source mark**, so a reader can tell URL-verified rows from self-added ones.
5. **Bulk confirm for Strong matches?** Recommended: **yes, through a dialog listing every row**; Possible and ambiguous rows one at a time.
6. **When a private URL later names the same appearance for someone else, who keeps it?** Recommended: **the private-URL holder**, with a notification to the other user.
7. **Tab name?** Recommended: **"Found"** under the CV nav (short, fits the phone strip); alternatives "Suggested", "Discover".
8. **Block appearances at tournaments with known same-name collisions until phase 7?** Recommended: **yes**; adding one could credit another person's scores.
9. **Common-name threshold:** a name seen at more than 4 tournaments in one year never reaches Strong. Recommended: **4**; I can tune it from the corpus.
10. **Forwarded-URL names:** an anchor that is `different` from all the user's other names and their Google name needs an admin check before discovery uses it. Recommended: **yes**.
11. **Daily limit on decisions?** Recommended: **100 per day**, well above any real career.
12. **Should "Not me" rows be retried after a matcher improvement?** Recommended: **no, a rejection is permanent until the user restores it**.

## 10. Owner decisions (2026-10-27, final)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Tournament without a private URL on the CV | **Yes, later**, marked "Added from public tab". Not in phase 1. |
| 2 | Phase 1 before option B | **Yes, read-only**: a list with "This is me" / "Not me", no CV writes, behind a flag, owner first. |
| 3 | Seed names | **Registration names from the user's own ingested private URLs only.** Never the Google name, never typed names. |
| — | Close names | Always need the user's own tick. **No auto-add**, ever. |
| 5 | Bulk confirm | **Strong matches only, through a dialog listing every row.** Phase 1 records decisions only. |
| 7 | Tab name | **"Found"** in `CvSubNav`, following the header-nav rules (current-page marker, focus after navigation). |
| 8 | Same-name-collision tournaments | **Allowed, with a visible warning** (not blocked as section 3.3 proposed). |
| 9 | Common-name threshold | **4**: a name at more than 4 tournaments in one year never reaches Strong. |
| 10 | Forwarded-URL names | **Admin check before seeding.** Phase 1 excludes such anchors and shows the count to admins only. |
| 11 | Daily limit | **50 decisions per user per day**, server enforced (not 100). |
| 12 | "Not me" | **Permanent until the user restores it**, from a "Hidden" list. Keyed on tournament + person so it survives re-scrapes. |
| — | Double surnames, one-word names | Always go to the user (tier Ambiguous, never bulk). |
| — | Matching rules | One person cannot speak and judge, or be on two teams or two panels, in the same **round**; across rounds is fine. Swing and stand-in names are mostly irrelevant (excluded). EUDC is the only event where one person may be in both the Open and the ESL outround. Open and Novice finals at one tournament cannot be one person. HWS double panels are an exception (two panels in one round is "check", not a block). |

Questions 4 and 6 (public CV display, private URL outranks discovery) belong to phases 3-4 and are not decided by phase 1.

## 11. Phase 1 as built

- **Table:** `AppearanceCandidate`, exactly as section 2.1, plus foreign keys to `User`, `Tournament`, `Person` (cascade) and single-column indexes on `tournamentId` and `personId` for the cascades. Migration `20261027120000_appearance_candidate`; rollback is `DROP TABLE "AppearanceCandidate"`. Only decided rows are written (`confirmed`, `rejected`, or `candidate` after an undo); undecided matches are computed on each visit.
- **Flag:** `lib/discovery/flag.ts`. On for the admin allowlist (`ADMIN_EMAIL`, which is how the owner gets it) and for addresses in `DISCOVERY_LIST_EMAILS`; `DISCOVERY_LIST=off` turns it off for everyone. Page, `CvSubNav` item and API all call the one function; without the flag the page is the not-found page and the API answers 404.
- **Matcher:** `lib/discovery/` (`names.ts` anchors and lookup keys, `rounds.ts` same-round rule, `match.ts` tiers, score and evidence, `view.ts` page shaping). Tiers are Strong, Possible, Ambiguous and Blocked (the spec's "Weak" became Ambiguous; low-score rows stay in Possible). Strong also requires no warning of any kind (collision, common name, another user's claim, a clash with another row).
- **Candidates are found without scanning `Person`:** exact probes of enumerated keys (accent loss in the v1 key, initials, short and one-typo first names, one-typo surnames, surname-first order, double-surname prefixes) plus btree range scans on the first name and surname, each capped at 300 rows. Section 6's "scan about 56k rows" was dropped.
- **Not built in phase 1:** co-panellist evidence (`JudgeAssignment` has no panel id), the institution-token heuristic, the checker's offline overlap list, the Record-page notice, admin approval of held-back anchors, and the account export of decisions.
- **Decisions:** `POST /api/discovery/decisions`, 1-50 items per request, each charged against `discovery:decide` (50 a day). Each item must be in the user's current list; a blocked row cannot be marked as theirs; more than one "This is me" in one request must all be Strong.
