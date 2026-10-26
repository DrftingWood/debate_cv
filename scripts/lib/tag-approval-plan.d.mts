export type TagKind = 'region' | 'motion_type' | 'motion_topic';

export const TAG_KINDS: Record<TagKind, { table: string; column: string; joinSql: string; targetSql: string }>;
export const KIND_NAMES: TagKind[];

export type Options = { apply: boolean; kind: TagKind | null; out: string; batch: number };
export function parseArgs(argv: string[]): Options;

export type PendingGroupRow = {
  kind: string;
  tournamentId: string;
  motionId: string | null;
  value: string;
  n: number;
  current?: string | null;
  tournamentName?: string | null;
};

type TargetBase = {
  kind: TagKind;
  tournamentId: string;
  tournamentName: string | null;
  motionId: string | null;
  current: string | null;
  proposals: number;
};
export type ValueCount = { value: string; n: number };
export type AgreedTarget = TargetBase & { value: string };
export type ConflictTarget = TargetBase & { values: ValueCount[] };
export type MalformedTarget = TargetBase & { values: ValueCount[]; tournamentIds: string[]; reason: string };
export type Plan = {
  agreed: AgreedTarget[];
  conflicts: ConflictTarget[];
  malformed: MalformedTarget[];
  ignored: number;
};
export function classifyPending(rows: PendingGroupRow[]): Plan;

export type KindSummary = {
  agreedTargets: number;
  agreedProposals: number;
  wouldSet: number;
  wouldOverwrite: number;
  alreadyEqual: number;
  conflictTargets: number;
  conflictProposals: number;
  malformedTargets: number;
  malformedProposals: number;
};
export function summarisePlan(plan: Plan): Record<TagKind, KindSummary>;

export function chunk<T>(items: T[], size: number): T[][];
export function buildApplySql(kind: string): string;
export function batchParams(targets: { tournamentId: string; motionId: string | null; value: string }[]): [string[], string[], string[]];
export function csvField(v: unknown): string;
export function csvLine(fields: unknown[]): string;
export function conflictCsv(plan: Plan): string;
export function beforeCsv(agreed: AgreedTarget[]): string;
