import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  MOTION_TYPES,
  MOTION_TOPICS,
  type MotionType,
  type MotionTopic,
} from './vocabulary';

/**
 * Claude-Haiku-backed motion classifier. Pre-fills TagProposal rows from
 * Motion.text so the admin reviews suggestions instead of tagging from
 * scratch — the moderation gate is unchanged: nothing the classifier
 * produces touches the canonical Motion.motionType / Motion.topic columns
 * until a human approves it on /admin/tags.
 *
 * Haiku rather than a bigger model: this is a bounded classification into
 * two fixed enums, exactly the cheap-and-fast tier's job, and it runs as
 * an admin-triggered batch where per-motion cost dominates. Structured
 * outputs (output_config.format) constrain the response to the schema, so
 * the vocabulary lists in lib/tags/vocabulary.ts stay the single source
 * of truth — adding a topic there automatically widens the classifier.
 */

const CLASSIFIER_MODEL = 'claude-haiku-4-5';

/** Motions per API call. Keeps each request well under output limits and
 * lets a serverless invocation classify a useful chunk inside its budget. */
const BATCH_SIZE = 20;

export type MotionToClassify = {
  id: bigint;
  text: string;
  infoSlide: string | null;
};

export type MotionClassification = {
  id: bigint;
  motionType: MotionType;
  topic: MotionTopic;
};

// Validation is duplicated on purpose: the JSON schema below constrains
// generation server-side (structured outputs), and the zod schema
// re-validates what came back before anything touches the DB. The SDK's
// zodOutputFormat helper would collapse the two, but it requires zod
// ≥3.25's v4 core and this repo pins zod 3.23 — hand-rolling the JSON
// schema beats bumping the validation library every API route depends on.
const responseSchema = z.object({
  classifications: z.array(
    z.object({
      /** 0-based position in the batch we sent — bigint ids don't survive JSON. */
      index: z.number().int(),
      motionType: z.enum(MOTION_TYPES as unknown as [string, ...string[]]),
      topic: z.enum(MOTION_TOPICS as unknown as [string, ...string[]]),
    }),
  ),
});

const outputFormat = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            motionType: { type: 'string', enum: [...MOTION_TYPES] },
            topic: { type: 'string', enum: [...MOTION_TOPICS] },
          },
          required: ['index', 'motionType', 'topic'],
          additionalProperties: false,
        },
      },
    },
    required: ['classifications'],
    additionalProperties: false,
  },
};

export function isClassifierConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `You classify competitive-debate motions for an analytics product.

For each motion, assign:
- motionType: the motion stem. THBT = "This House Believes That", THW = "This House Would", THS = "This House Supports", THO = "This House Opposes", THR = "This House Regrets", THP = "This House Prefers". Use "Other" for unusual stems (e.g. "This House, as the EU, would ...") or non-This-House phrasings.
- topic: the single best-fitting subject area for what the motion is substantively about. Judge by the core clash, not surface vocabulary — "THW ban fossil-fuel advertising" is Environment & Climate, not Media & Arts. Info slides give context; weigh them.

Classify every motion you are given, in order.`;

/**
 * Classify a list of motions. Batches internally; returns one entry per
 * motion the model classified (a motion can be missing from the result if
 * a batch fails — callers treat absence as "not classified this run").
 * Throws only on configuration errors; per-batch API failures are
 * swallowed after the first batch so a partial run still yields proposals.
 */
export async function classifyMotions(
  motions: MotionToClassify[],
): Promise<MotionClassification[]> {
  if (!isClassifierConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  const client = new Anthropic();
  const results: MotionClassification[] = [];

  for (let start = 0; start < motions.length; start += BATCH_SIZE) {
    const batch = motions.slice(start, start + BATCH_SIZE);
    const listing = batch
      .map(
        (m, i) =>
          `${i}. ${m.text.trim()}${m.infoSlide ? `\n   Info slide: ${m.infoSlide.trim().slice(0, 500)}` : ''}`,
      )
      .join('\n');

    try {
      const response = await client.messages.create({
        model: CLASSIFIER_MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Classify these ${batch.length} motions:\n\n${listing}`,
          },
        ],
        output_config: { format: outputFormat },
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') continue;
      const parsed = responseSchema.safeParse(JSON.parse(textBlock.text));
      if (!parsed.success) continue;
      for (const c of parsed.data.classifications) {
        const motion = batch[c.index];
        if (!motion) continue;
        results.push({
          id: motion.id,
          motionType: c.motionType as MotionType,
          topic: c.topic as MotionTopic,
        });
      }
    } catch (err) {
      // First batch failing usually means a config/availability problem the
      // admin should see; later batches failing shouldn't discard the
      // classifications already collected.
      if (start === 0) throw err;
      break;
    }
  }

  return results;
}
