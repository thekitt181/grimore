import axios, { type InternalAxiosRequestConfig } from 'axios';
import { getApiBaseUrl } from './appUrls';

export const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
});

type AuthTokenGetter = (opts?: { skipCache?: boolean }) => Promise<string | null>;

let getAuthToken: AuthTokenGetter | null = null;

export function setAuthTokenGetter(fn: AuthTokenGetter) {
  getAuthToken = fn;
}

export function isApiAuthError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 401;
}

/** Wait for a Clerk token (refreshing when needed) before compendium refetches. */
export async function ensureApiAuthToken(opts?: {
  attempts?: number;
  delayMs?: number;
}): Promise<string | null> {
  if (!getAuthToken) return null;
  const attempts = opts?.attempts ?? 4;
  const baseDelay = opts?.delayMs ?? 350;
  for (let i = 0; i < attempts; i++) {
    const token = await getAuthToken({ skipCache: i > 0 });
    if (token) return token;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, baseDelay * (i + 1)));
    }
  }
  return null;
}

function dispatchAuthEvent(name: 'grimoire:auth-expired' | 'grimoire:auth-recovered'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name));
}

async function attachAuthHeaders(config: InternalAxiosRequestConfig): Promise<void> {
  if (getAuthToken) {
    const token = await getAuthToken();
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  try {
    const { useSessionStore } = await import('@/store/sessionStore');
    const sessionId = useSessionStore.getState().sessionId;
    if (sessionId) {
      config.headers['X-Session-Id'] = sessionId;
    }
  } catch {
    // store unavailable during SSR/tests
  }
  try {
    const { getCompendiumAdminPassword } = await import('@/systems/compendium/compendiumAdminStore');
    const adminPassword = getCompendiumAdminPassword();
    if (adminPassword) {
      config.headers['X-Compendium-Admin-Password'] = adminPassword;
    }
  } catch {
    // ignore
  }
}

api.interceptors.request.use(async (config) => {
  await attachAuthHeaders(config);
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & {
  __authRetried?: boolean;
  __wakeRetryCount?: number;
};

const WAKE_RETRY_MAX = 4;
const WAKE_RETRY_STATUSES = new Set([502, 503, 504]);

function wakeRetryDelayMs(attempt: number): number {
  return Math.min(1500 * 2 ** attempt, 12_000);
}

api.interceptors.response.use(
  (res) => res,
  async (err: unknown) => {
    if (!axios.isAxiosError(err) || !err.config) {
      return Promise.reject(err);
    }

    const config = err.config as RetriableConfig;
    const status = err.response?.status;

    if (status != null && WAKE_RETRY_STATUSES.has(status)) {
      const attempt = config.__wakeRetryCount ?? 0;
      if (attempt < WAKE_RETRY_MAX) {
        config.__wakeRetryCount = attempt + 1;
        await new Promise((r) => setTimeout(r, wakeRetryDelayMs(attempt)));
        return api.request(config);
      }
    }

    if (status === 401 && !config.__authRetried && getAuthToken) {
      config.__authRetried = true;
      const token = await getAuthToken({ skipCache: true });
      if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
        dispatchAuthEvent('grimoire:auth-recovered');
        return api.request(config);
      }
      dispatchAuthEvent('grimoire:auth-expired');
    } else if (status === 401) {
      dispatchAuthEvent('grimoire:auth-expired');
    }

    if (status !== 401 && !(status != null && WAKE_RETRY_STATUSES.has(status))) {
      const data = err.response?.data as { error?: string; message?: string } | undefined;
      const msg = data?.error ?? data?.message ?? err.message;
      console.error('[API]', msg);
    }
    return Promise.reject(err);
  },
);
