import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { REGIONS, type Region } from './vocabulary';
import { isClassifierConfigured } from './classifyMotions';

/**
 * Claude-Haiku region suggestions for tournaments. Same contract as the
 * motion classifier: it only produces suggestions, which the route files as
 * pending TagProposal rows. Nothing here writes Tournament.region.
 *
 * Where it differs: the model is allowed to say "unsure", and an unsure
 * answer is dropped rather than filed. A wrong region on a CV is worse than a
 * blank one the admin fills in, and many tournament names carry no place at
 * all ("Nationals 2023", "Open 2024").
 */

const CLASSIFIER_MODEL = 'claude-haiku-4-5';
const BATCH_SIZE = 30;
const UNSURE = 'Unsure';

export type TournamentToClassify = {
  id: bigint;
  name: string;
  format: string | null;
  year: number | null;
  /** The tournament's host, e.g. "wudc2022.calicotab.com" — sometimes names the place. */
  host: string;
};

export type TournamentRegion = { id: bigint; region: Region };

const responseSchema = z.object({
  regions: z.array(
    z.object({
      index: z.number().int(),
      region: z.enum([...REGIONS, UNSURE] as unknown as [string, ...string[]]),
    }),
  ),
});

const outputFormat = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      regions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            region: { type: 'string', enum: [...REGIONS, UNSURE] },
          },
          required: ['index', 'region'],
          additionalProperties: false,
        },
      },
    },
    required: ['regions'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You assign a world region to competitive-debate tournaments for an analytics product.

For each tournament, give the region where it was HELD, judged from its name, its host name and its year. Examples: a tournament named after a city or country, or a university, belongs to that place's region. Use "International / Online" only for tournaments that were explicitly online or that have no host place, and use "${UNSURE}" whenever the name does not tell you where it was held. A wrong answer is worse than "${UNSURE}": never guess from the format or from the language of the name alone.

Answer every tournament, in order.`;

/** Returns only the tournaments the model was confident about. */
export async function classifyTournamentRegions(
  tournaments: TournamentToClassify[],
): Promise<TournamentRegion[]> {
  if (!isClassifierConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  const client = new Anthropic();
  const results: TournamentRegion[] = [];

  for (let start = 0; start < tournaments.length; start += BATCH_SIZE) {
    const batch = tournaments.slice(start, start + BATCH_SIZE);
    const listing = batch
      .map(
        (t, i) =>
          `${i}. ${t.name.trim()} | host: ${t.host} | ${t.year ?? 'year unknown'}${t.format ? ` | ${t.format}` : ''}`,
      )
      .join('\n');

    try {
      const response = await client.messages.create({
        model: CLASSIFIER_MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Assign a region to these ${batch.length} tournaments:\n\n${listing}`,
          },
        ],
        output_config: { format: outputFormat },
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') continue;
      const parsed = responseSchema.safeParse(JSON.parse(textBlock.text));
      if (!parsed.success) continue;
      for (const r of parsed.data.regions) {
        const t = batch[r.index];
        if (!t || r.region === UNSURE) continue;
        results.push({ id: t.id, region: r.region as Region });
      }
    } catch (err) {
      if (start === 0) throw err;
      break;
    }
  }
  return results;
}
