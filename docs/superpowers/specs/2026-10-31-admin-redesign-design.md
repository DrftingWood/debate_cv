# Admin redesign: a work queue with tabs

Owner, 2026-10-31:
- "check the admin page … very critical view, how am i supposed to make updates, changes, stuff, and make a real difference, redundancy exists, pointless stuff is being shown, guidelines and rules not followed please fix";
- "lots of redundancy, if i am supposed check something, i should be able to mark it … more user friendly, comprehensive, not heavy … different tabs, instead of the dump".

Builds on the accuracy work (PRs #265 and part 2). Binding rules: `docs/DESIGN_INSTRUCTIONS.md` §6, `docs/UI_UX_STANDARDS.md`, and the owner's standing rules: properly scraped tournaments are never highlighted; tournament URLs are clickable public links; 20 rows per page with Next.

## Problems in the live page (2026-10-31)
1. Thirteen stacked sections and no "what needs me now".
2. Pointless content:
   - an empty "Scrape health" section ("Every tracked tournament loaded in full");
   - Locked and Discovered URL tiles that drive no action;
   - parser warnings led by informational notes ("competition likely finished" ×184, "breakTabs not found (optional)", "constructed as fallback", "tab not released"), while the real problems ("round → 0 results") are buried;
   - Open questions printing 47 names inline.
3. Noise: about 198 "failed imports", most of them 404s for tournaments already stored from the pre-scrape (the user has the data); the same tournament repeated across users.
4. Redundancy:
   - "In database" and "Tab" status in separate cells;
   - several "Tab ↗" links per row;
   - the accuracy chart and the lowest-scores table presenting the same failures twice;
   - the tiles repeating the section headers.
5. No way to say "I checked this, the data is right". The live sample of "Rooms per round" flags (ANDL 2025 R11 one room, Uhuru Panthera R1–R3 larger, ASDPL 2023 R4 one short) is mostly genuine tab oddities, which can only be resolved by a person.
6. Bugs:
   - "1 Jan 1970" shown as a scrape date (the Re-ingest-all epoch marker);
   - "Export errors" placed under the state tiles.

## Design

### Structure
`/admin` with URL-synced tabs (`?tab=`), using the existing `components/ui/Tabs` (APG, URL-synced):

| Tab | Holds | Default view |
|---|---|---|
| **Inbox** (default) | Every open item needing the owner | Sorted by impact |
| **Tournaments** | The stored-tournaments list with score and checks (today's `/admin/tournaments` content; that route redirects here) | Lowest score first; search; filter chips per failing check with counts; band filter |
| **Imports** | Failed import jobs | "Not stored" only; a "Covered by stored copy" filter shows the rest |
| **Reports** | CV error reports | Open |
| **Parser** | Parser warnings | "Problems" only; an "Informational" toggle |
| **Review set** | Flags for Claude | Open, by priority; export |
| **Tools** | Lookup box, verify, tagging, tag proposals, exports, queue actions (Re-ingest all), and a collapsed **Danger zone** (Clear data, Full wipe) | — |

A **summary line** sits above the tabs on every tab: "Needs you N · Accuracy 91 (Good 915 · Check 414 · Re-scrape 55) · Imports failing N · Queue N". Each figure links to its tab and filter. No other tiles.

`/admin/tournaments/[id]` stays the detail page and gains per-check actions.

### Inbox items
One list. Item kinds and when they appear:
- **check**: a tournament check with status fail or warn that isn't marked checked (fingerprint below). One item per tournament, listing its open checks, so the inbox never repeats a tournament.
- **report**: a CV report that is open or acknowledged.
- **import**: a failed or abandoned import whose tournament is **not stored**, or is ambiguous. One item per tournament or URL, listing the affected users, so there are no repeats across users.
- **parser**: a parser-problem group (round → 0 results, `fetch: … HTTP`, parse errors), not informational notes.
- **review**: open review-set flags show as a badge on their item, not as separate items.

Each row has:
- a kind badge (word);
- the tournament (link to the detail page) with one status cell (✓ / ? / ✗, plus the word);
- one sentence on what's wrong (the first failing detail, plus "+n more");
- impact: users with it on their CV;
- age;
- actions: **Fix** (the kind's primary action: Re-scrape suggested, Retry, Open report), **Mark checked**, **Review later** (opens the existing priority and comment form). A row menu holds the rest (Open tab ↗, Open detail).

Order: users affected (desc), then severity (fail before warn), then age. 20 per page. Type filter chips with counts. Bulk select with Mark checked and Review later.

### Mark checked (new)
- Model `AdminCheck`:
  - `id BigInt`;
  - `kind String` ('check' | 'report' | 'import' | 'parser');
  - `subject String` (check: `<tournamentId>:<code>`; report: `<reportId>`; import: `<host>/<slug>` or job id; parser: `<parser>|<headline>`);
  - `fingerprint String`;
  - `note String?` (≤ 500);
  - `checkedBy String`;
  - `checkedAt DateTime`.
  - Unique on (kind, subject). Additive migration.
- **Fingerprints** make a mark lapse when the data changes:
  - check: status plus detail sentence;
  - import: last error category plus attempts;
  - parser: the count bucket;
  - report: status.

  A mark with a different fingerprint is ignored (the item comes back, labelled "Changed since you checked it").
- **Score:** a check marked checked with a matching fingerprint counts as a pass, with the detail "Checked by <name> on <date>". It is applied in `runAudit` when scoring, and stored in the audit's checks JSON as `checkedBy`/`checkedAt`, so the tables can show it. Marking re-audits that tournament straight away.
- **Undo:** "Undo" in the toast and in the detail page. A "Checked" filter on each tab lists marks, each with an Undo.
- **Reports:** Mark checked sets status `acknowledged`. "Fixed" and "Won't fix" stay in the Reports tab.

### Redundancy removed
- One status cell (✓ Loaded / ? Partly / ? Check / ✗ Not loaded) replaces "In database" plus "Tab".
- One "Tab ↗" per row: the row menu or the status cell, not both.
- The failing-checks chart becomes the Tournaments tab's filter chips, the same data shown once.
- No "Lowest scores" section: that is the Tournaments tab sorted by score.
- Open questions are one line in the Tournaments tab's filter bar ("Open question: champion when no Open bracket, 47"), filtering the list, with the rule text in a disclosure.
- Scrape health is not a section: a partly loaded tournament appears in the Inbox as a check (`scrape_incomplete`) and in the Tournaments filters.
- The Locked and Discovered URL tiles are removed; their counts live in Tools beside Re-ingest all.

### Bugs
- A scrape date at the epoch marker shows "Re-scrape queued" (or an em dash), never "1 Jan 1970". This applies everywhere `scrapedAt` is shown.
- "Export errors" moves to Imports.

## Out of scope
Notifications to the owner. Automatic re-scrapes from the Inbox. Changes to the public site.
