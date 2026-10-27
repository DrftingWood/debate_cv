export function shouldMigrate(env: Record<string, string | undefined>): {
  migrate: boolean;
  reason: string;
};
