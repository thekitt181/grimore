export function isDbPoolSaturation(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2024') {
    return true;
  }
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return /ECHECKOUTTIMEOUT|P2024|pool after|Timed out fetching a new connection|connection pool/i.test(msg);
}

/** withDbTimeout and other fast-fail wrappers — should not surface as 401 Unauthorized. */
export function isDbTransientError(err: unknown): boolean {
  if (isDbPoolSaturation(err)) return true;
  if (!(err instanceof Error)) return false;
  return /\[DB\].*timed out after \d+ms/i.test(err.message);
}

/** Fail fast when the Postgres pool is saturated. On timeout, resets the Prisma pool so
 *  orphaned queries (which Prisma cannot cancel) do not block every subsequent request. */
export async function withDbTimeout<T>(
  ms: number,
  fn: () => Promise<T>,
  label = 'query',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void import('./prisma').then(({ resetPrismaPool }) => resetPrismaPool(`timeout:${label}`));
      reject(new Error(`[DB] ${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
