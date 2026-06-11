/** PostgreSQL text/JSON rejects U+0000 — strip from all strings before Prisma writes. */
export function stripNullBytes(value: string): string {
  if (!value.includes('\u0000')) return value;
  return value.replace(/\u0000/g, '');
}

export function sanitizeForPostgres<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return stripNullBytes(value) as T;
  if (Array.isArray(value)) return value.map((entry) => sanitizeForPostgres(entry)) as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeForPostgres(entry);
    }
    return out as T;
  }
  return value;
}
