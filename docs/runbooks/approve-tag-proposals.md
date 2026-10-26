# Approving the pending tag proposals from a terminal

**Why.** About 10,000 tag proposals (region, motion type, motion topic) are pending. The admin page's "approve all" (`POST /api/admin/tag-proposals/approve-all`) handles at most 300 per request and runs one transaction per proposal, so it does not get through the backlog. `scripts/approve-tag-proposals.mjs` does the same approval set-based, a few thousand targets per statement.

**What it does.** The same thing as approving each proposal on the page (`lib/tags/approve.ts` `approveProposalTx`): the value is written to `Tournament.region`, `Motion.motionType` or `Motion.topic`, and every pending proposal with that same value for that same tournament or motion is approved with it.

**What it does not do.**

- A tournament or motion whose pending proposals name **two or more different values** is a conflict. All of its proposals stay pending and it is listed in `conflicts-<stamp>.csv` for you to decide on the admin page. (The page's approve-all would have approved them all in order, the last one winning.)
- It writes nothing except `TagProposal.status`, `TagProposal.reviewedAt` and those three columns. It does not clear `adminNote` and does not touch `Tournament.updatedAt` (the page does both).
- Rows that look wrong (a region proposal that carries a motion id, a motion proposal without one, or one motion's proposals naming different tournaments) are skipped and listed in the same CSV.

**Safety.** The default is a dry run that only reads. `--apply` writes. Each batch is one statement, so a batch is all-or-nothing. Re-running is safe: approved rows are no longer pending, so they are not touched again, and a run that stopped part-way continues where it stopped. Every proposal approved by one run gets the same `reviewedAt`, printed as the **run stamp**, which is how you find that run later.

The connection string is read from `POSTGRES_URL_NON_POOLING` in the current PowerShell window (or a hidden prompt if it is not set). `.env` files are ignored. A pooled string (`-pooler` in the host) is switched to the direct host for you. The script never prints it.

Run the steps in order.

## 1. Take a Neon branch first (recommended)

A branch is a copy of the database at this moment, made in seconds, and it is the only complete undo. In the Neon console: **Branches → Create branch**, parent `main` (production), name it `before-tag-approval-<date>`, "Current point in time". Do not connect the app to it; it is only there to restore from. Delete it a week or two later once you are happy.

(Neon's point-in-time restore also works without a branch, within the plan's history window, but it rolls back **everything** written since, including new ingests. A branch lets you copy back only the tag columns.)

## 2. Record the numbers before

In the Neon SQL editor, on the production branch:

```sql
-- proposals by kind and status
SELECT kind, status, count(*) FROM "TagProposal" GROUP BY 1, 2 ORDER BY 1, 2;

-- canonical tags currently set
SELECT
  (SELECT count(*) FROM "Tournament" WHERE region IS NOT NULL)       AS tournaments_with_region,
  (SELECT count(*) FROM "Motion"     WHERE "motionType" IS NOT NULL) AS motions_with_type,
  (SELECT count(*) FROM "Motion"     WHERE topic IS NOT NULL)        AS motions_with_topic;
```

Keep the output.

## 3. Dry run (reads only)

In PowerShell, from the repo folder. Copy the **direct** connection string from the Neon Connect dialog (production branch) first, then:

```powershell
cd "C:\Users\achar\Documents\6. Projects\2. Debate CV\debate_cv"
$env:POSTGRES_URL_NON_POOLING = (Get-Clipboard) -join "`n"
node scripts/approve-tag-proposals.mjs
```

It prints the proposals by kind and status, then for each kind: how many targets have exactly one pending value (and how many proposals that covers; how many of those would set an empty tag, would overwrite a different existing tag, or already match), and how many are conflicts with two or more values. The conflicts are written to `tag-approval-output\conflicts-<stamp>.csv` (git-ignored). Open it and look at a few rows.

Pay attention to **"would overwrite a different value"**: those tags are already set and the pending proposals say something else. That is what the page would do too, but if the number is larger than you expect, stop and look before applying.

To look at one kind only, add `--kind region`, `--kind motion_type` or `--kind motion_topic`.

## 4. Apply

In the same window (the variable is still set):

```powershell
node scripts/approve-tag-proposals.mjs --apply
```

It first writes `tag-approval-output\canonical-before-<stamp>.csv` (what each tag held before this run) and prints the **run stamp**, for example `2026-10-27T10:15:00.123Z`. **Copy the run stamp somewhere**; the rollback needs it. Then it prints one progress line per batch and the counts by kind and status afterwards.

If it stops part-way (network drop, laptop sleep), run the same command again. The second run has a new stamp; note both.

Then remove the variable so the string does not stay in the session:

```powershell
Remove-Item Env:POSTGRES_URL_NON_POOLING
```

## 5. Check

In the Neon SQL editor, replacing the stamp with yours (the `AT TIME ZONE 'UTC'` matters: the column holds UTC without a zone):

```sql
-- same as step 2: pending should now be about the conflict count from the dry run
SELECT kind, status, count(*) FROM "TagProposal" GROUP BY 1, 2 ORDER BY 1, 2;

-- what this run approved
SELECT kind, count(*) FROM "TagProposal"
WHERE "reviewedAt" = ('2026-10-27T10:15:00.123Z'::timestamptz AT TIME ZONE 'UTC')
GROUP BY 1;

-- no target is left with exactly one pending value (should return 0 rows, apart from
-- targets the CSV lists as skipped and proposals filed while the script ran)
SELECT kind, "tournamentId", "motionId"
FROM "TagProposal" WHERE status = 'pending'
GROUP BY 1, 2, 3 HAVING count(DISTINCT value) = 1;

-- every approved proposal from this run matches its canonical column (should return 0 rows)
SELECT p.id, p.kind, p.value, t.region, m."motionType", m.topic
FROM "TagProposal" p
JOIN "Tournament" t ON t.id = p."tournamentId"
LEFT JOIN "Motion" m ON m.id = p."motionId"
WHERE p."reviewedAt" = ('2026-10-27T10:15:00.123Z'::timestamptz AT TIME ZONE 'UTC')
  AND p.value IS DISTINCT FROM CASE p.kind WHEN 'region' THEN t.region
                                           WHEN 'motion_type' THEN m."motionType"
                                           ELSE m.topic END;

-- canonical counts, to compare with step 2
SELECT
  (SELECT count(*) FROM "Tournament" WHERE region IS NOT NULL)       AS tournaments_with_region,
  (SELECT count(*) FROM "Motion"     WHERE "motionType" IS NOT NULL) AS motions_with_type,
  (SELECT count(*) FROM "Motion"     WHERE topic IS NOT NULL)        AS motions_with_topic;
```

The last check can show rows if someone approved a different value on the admin page while the script ran; that is the later decision winning, not an error.

Then open `/admin/tags`: only the conflicts should be left, and a couple of tournaments on `/cv` should show their region.

## 6. Resolve the conflicts

Work through `conflicts-<stamp>.csv` on the admin page, approving the right value and rejecting the others. The script leaves them alone on every run.

## Rolling back

There is no automatic undo: an approval writes two things (the proposal's status and the tag column) and the script does not keep a history table. Choose one:

**A. From the Neon branch (recommended, complete).** If nothing else of value has been written since the run, the simplest way is Neon's **Restore** on the production branch to a time just before the run stamp (that rolls back every table). If other data has changed since (new ingests), restore only the tag data instead: export from the branch taken in step 1

```sql
-- on the snapshot branch
SELECT id, status, "reviewedAt" FROM "TagProposal";
SELECT id, region FROM "Tournament";
SELECT id, "motionType", topic FROM "Motion";
```

and update production from those rows.

**B. Without a branch, from the run stamp and the before-file.**

1. Put the proposals approved by the run back to pending (this finds exactly that run's rows, because every row it approved has the same `reviewedAt`):

   ```sql
   UPDATE "TagProposal" SET status = 'pending', "reviewedAt" = NULL
   WHERE status = 'approved'
     AND "reviewedAt" = ('2026-10-27T10:15:00.123Z'::timestamptz AT TIME ZONE 'UTC');
   ```

   Run it once per stamp if the run was resumed.

2. Restore the tag columns from `canonical-before-<stamp>.csv` (columns `kind, tournament_id, motion_id, previous_value, new_value`). For each row whose tag still equals `new_value`, set it back to `previous_value` (an empty `previous_value` means NULL):

   ```sql
   -- region rows
   UPDATE "Tournament" SET region = <previous_value or NULL> WHERE id = <tournament_id> AND region = '<new_value>';
   -- motion_type rows
   UPDATE "Motion" SET "motionType" = <previous_value or NULL> WHERE id = <motion_id> AND "motionType" = '<new_value>';
   -- motion_topic rows
   UPDATE "Motion" SET topic = <previous_value or NULL> WHERE id = <motion_id> AND topic = '<new_value>';
   ```

   For thousands of rows, load the CSV into a temporary table (`\copy` in `psql`) and do it with one `UPDATE ... FROM` per kind rather than by hand.

Option B cannot tell apart a tag the script wrote from the same value approved on the admin page afterwards, and it cannot restore `adminNote` (the script never changes it, so there is nothing to restore). That is why the branch is the recommended path.
