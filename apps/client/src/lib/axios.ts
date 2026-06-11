import axios, { type InternalAxiosRequestConfig } from 'axios';
import { getApiBaseUrl } from './appUrls';
import {
  clearApiAuthBlocked,
  isApiAuthBlocked,
  markApiAuthBlocked,
  wasApiSessionVerifiedRecently,
} from './apiAuthState';

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

/** Confirm the server accepts the current Clerk token (not just that Clerk returned one). */
export async function verifyApiSession(force = false): Promise<boolean> {
  if (!force && wasApiSessionVerifiedRecently() && !isApiAuthBlocked()) return true;
  if (!getAuthToken) return false;
  const token = await getAuthToken({ skipCache: true });
  if (!token) {
    markApiAuthBlocked('missing-token');
    return false;
  }
  try {
    await api.get('/users/me', {
      headers: { Authorization: `Bearer ${token}` },
      __authRetried: true,
    } as RetriableConfig);
    clearApiAuthBlocked();
    return true;
  } catch (err) {
    if (isApiAuthError(err)) markApiAuthBlocked('unauthorized');
    return false;
  }
}

export async function ensureApiAuthSession(force = false): Promise<boolean> {
  if (!force && isApiAuthBlocked()) return false;
  return verifyApiSession(force);
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
  (res) => {
    if ((res.config as RetriableConfig).__authRetried) {
      clearApiAuthBlocked();
      dispatchAuthEvent('grimoire:auth-recovered');
    }
    return res;
  },
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
      markApiAuthBlocked('missing-token');
      dispatchAuthEvent('grimoire:auth-expired');
    } else if (status === 401) {
      if (config.__authRetried) markApiAuthBlocked('unauthorized');
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
