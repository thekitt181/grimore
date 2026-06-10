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
        return api.request(config);
      }
    }

    if (status !== 401 && !(status != null && WAKE_RETRY_STATUSES.has(status))) {
      const data = err.response?.data as { error?: string; message?: string } | undefined;
      const msg = data?.error ?? data?.message ?? err.message;
      console.error('[API]', msg);
    }
    return Promise.reject(err);
  },
);
