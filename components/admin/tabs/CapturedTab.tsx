import {
  BalanceBody,
  CoverageBody,
  balanceCaption,
  coverageRows,
} from '@/components/admin/CapturedBalance';
import {
  CapturedSection,
  FormatsYearsBody,
  GeographyBody,
  MotionKindsBody,
  SizeBody,
  num,
} from '@/components/admin/CapturedParts';
import {
  countUnreleased,
  readBalance,
  readFormatsYears,
  readGeography,
  readMotionKinds,
  readSize,
} from '@/lib/admin/captured';
import { countMissingYears } from '@/lib/admin/yearFill';
import { orNull } from '@/lib/admin/orNull';
import { readOverview } from '@/lib/admin/summary';

type Data = Awaited<ReturnType<typeof readCaptured>>;

/** Every section's read, side by side; one that fails comes back null. */
async function readCaptured() {
  const [size, geo, formatsYears, motions, balance, overview, noYear, unreleased] =
    await Promise.all([
      readSize().catch(orNull('captured sizes')),
      readGeography().catch(orNull('captured regions')),
      readFormatsYears().catch(orNull('captured formats and years')),
      readMotionKinds().catch(orNull('captured motion types')),
      readBalance().catch(orNull('captured motion balance')),
      readOverview().catch(orNull('accuracy overview')),
      countMissingYears().catch(orNull('missing year count')),
      countUnreleased().catch(orNull('unreleased count')),
    ]);
  return { size, geo, formatsYears, motions, balance, overview, noYear, unreleased };
}

/**
 * Captured: what the stored tournaments look like in aggregate (R11). Each
 * section reads on its own and fails on its own (orNull), so a slow or broken
 * query leaves the other five on the page. Everything here leaves out
 * tournaments an admin set to ignored, and says so under the intro.
 */
export async function CapturedTab() {
  const data = await readCaptured();
  return (
    <div className="space-y-group">
      <div className="space-y-hair">
        <p className="max-w-prose text-body text-ink-soft">
          What the database holds, in aggregate: how big the tournaments are, where, in which
          formats and years, what the motions are, and how fair the seats were.
        </p>
        <p className="text-caption text-ink-soft">
          Tournaments set to ignored are left out of every figure here.
        </p>
      </div>
      <TournamentSections data={data} />
      <MotionSections data={data} />
    </div>
  );
}

/** Size, geography, formats and years: facts about the tournaments themselves. */
function TournamentSections({ data }: { data: Data }) {
  const { size, geo, formatsYears } = data;
  return (
    <>
      <CapturedSection
        id="captured-size"
        title="Size"
        failed={!size}
        caption={
          size ? `Teams stored per tournament, ${num(size.sampled)} tournaments.` : undefined
        }
      >
        {size ? <SizeBody size={size} /> : null}
      </CapturedSection>
      <CapturedSection
        id="captured-geography"
        title="Geography"
        failed={!geo}
        caption={
          geo
            ? `By region, ${num(geo.total)} tournaments. Region only: no country is stored.`
            : undefined
        }
      >
        {geo ? <GeographyBody geo={geo} /> : null}
      </CapturedSection>
      <CapturedSection
        id="captured-formats"
        title="Formats and years"
        failed={!formatsYears}
        caption={formatsYears ? `${num(formatsYears.total)} tournaments.` : undefined}
      >
        {formatsYears ? <FormatsYearsBody data={formatsYears} /> : null}
      </CapturedSection>
    </>
  );
}

/** Motion types, how fair the seats were, and the coverage gaps that close the tab. */
function MotionSections({ data }: { data: Data }) {
  const { motions, balance, overview, noYear, unreleased, formatsYears } = data;
  return (
    <>
      <CapturedSection
        id="captured-motions"
        title="Motion types"
        failed={!motions}
        caption={motions ? `${num(motions.total)} motions.` : undefined}
      >
        {motions ? <MotionKindsBody data={motions} /> : null}
      </CapturedSection>
      <CapturedSection
        id="captured-balance"
        title="Motion balance"
        failed={!balance}
        caption={balance ? balanceCaption(balance) : undefined}
      >
        {balance ? <BalanceBody balance={balance} /> : null}
      </CapturedSection>
      <CapturedSection
        id="captured-coverage"
        title="Coverage gaps"
        caption="Counts of tournaments, each linking to the list and the bulk fix."
      >
        <CoverageBody
          rows={coverageRows({ overview, noYear, unreleased, stored: formatsYears?.total ?? null })}
        />
      </CapturedSection>
    </>
  );
}
