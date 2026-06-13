const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FETCH_TIMEOUT_MS = 90_000;

/** Fetch with backoff on rate limits and transient server errors. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: { attempts?: number; label?: string; timeoutMs?: number },
): Promise<Response> {
  const attempts = opts?.attempts ?? 3;
  const label = opts?.label ?? url;
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (res.ok || res.status === 404) return res;
      if (RETRYABLE_STATUS.has(res.status) && i < attempts - 1) {
        const delay = 400 * (i + 1) + Math.floor(Math.random() * 200);
        console.warn(`[DDB] ${label} HTTP ${res.status} — retry in ${delay}ms (${i + 1}/${attempts})`);
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delay = 400 * (i + 1);
        console.warn(
          `[DDB] ${label} network error — retry in ${delay}ms:`,
          err instanceof Error ? err.message : err,
        );
        await sleep(delay);
      }
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error(`DDB fetch failed after ${attempts} attempts (${label})`);
}
