export function isDbPoolSaturation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return /ECHECKOUTTIMEOUT|P2024|pool after|Timed out fetching a new connection|connection pool/i.test(msg);
}

/** Fail fast when the Postgres pool is saturated (avoids 60s Supabase checkout waits). */
export async function withDbTimeout<T>(
  ms: number,
  fn: () => Promise<T>,
  label = 'query',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[DB] ${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
