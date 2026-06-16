import axios, { type InternalAxiosRequestConfig } from 'axios';
import { setBearerToken } from '@/lib/auth-client';
import { getCompendiumAdminPassword } from '@/systems/compendium/compendiumAdminStore';
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

export function isApiDbBusyError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 503;
}

/** Confirm the server accepts the current session (cookie and/or bearer). */
export async function verifyApiSessionState(force = false): Promise<'ok' | 'unauthorized' | 'busy'> {
  if (!force && wasApiSessionVerifiedRecently() && !isApiAuthBlocked()) return 'ok';

  let authHeader: string | undefined;
  if (getAuthToken) {
    const token = await getAuthToken({ skipCache: true });
    if (token) authHeader = `Bearer ${token}`;
  }

  try {
    await api.get('/users/me', {
      ...(authHeader ? { headers: { Authorization: authHeader } } : {}),
      __authRetryStage: 99,
    } as RetriableConfig);
    clearApiAuthBlocked();
    return 'ok';
  } catch (err) {
    if (isApiDbBusyError(err)) return 'busy';
    if (isApiAuthError(err)) markApiAuthBlocked('unauthorized');
    return 'unauthorized';
  }
}

export async function verifyApiSession(force = false): Promise<boolean> {
  const state = await verifyApiSessionState(force);
  return state === 'ok';
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
  const adminPassword = getCompendiumAdminPassword();
  if (adminPassword) {
    config.headers['X-Compendium-Admin-Password'] = adminPassword;
  }
}

api.interceptors.request.use(async (config) => {
  await attachAuthHeaders(config);
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & {
  __authRetryStage?: number;
  __wakeRetryCount?: number;
  __networkRetryCount?: number;
};

const WAKE_RETRY_MAX = 5;
const NETWORK_RETRY_MAX = 3;
const WAKE_RETRY_STATUSES = new Set([502, 503, 504]);

function wakeRetryDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 15_000);
}

api.interceptors.response.use(
  (res) => {
    if ((res.config as RetriableConfig).__authRetryStage === 99) {
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
    const isNetworkError = !err.response && (
      err.code === 'ERR_NETWORK'
      || err.message === 'Network Error'
    );

    if (isNetworkError) {
      const attempt = config.__networkRetryCount ?? 0;
      if (attempt < NETWORK_RETRY_MAX) {
        config.__networkRetryCount = attempt + 1;
        await new Promise((r) => setTimeout(r, wakeRetryDelayMs(attempt)));
        return api.request(config);
      }
    }

    if (status != null && WAKE_RETRY_STATUSES.has(status)) {
      const attempt = config.__wakeRetryCount ?? 0;
      if (attempt < WAKE_RETRY_MAX) {
        config.__wakeRetryCount = attempt + 1;
        await new Promise((r) => setTimeout(r, wakeRetryDelayMs(attempt)));
        return api.request(config);
      }
    }

    if (status === 401) {
      const stage = config.__authRetryStage ?? 0;

      if (stage === 0 && config.headers['Authorization']) {
        config.__authRetryStage = 1;
        setBearerToken(null);
        delete config.headers['Authorization'];
        return api.request(config);
      }

      if (stage <= 1 && getAuthToken) {
        config.__authRetryStage = 2;
        const token = await getAuthToken({ skipCache: true });
        if (token) {
          config.headers['Authorization'] = `Bearer ${token}`;
          return api.request(config);
        }
      }

      markApiAuthBlocked(stage >= 2 ? 'unauthorized' : 'missing-token');
      dispatchAuthEvent('grimoire:auth-expired');
      if (stage >= 2) {
        void import('@/lib/auth-client').then(({ signOutAndClear }) => signOutAndClear());
      }
    }

    if (status !== 401 && status !== 404 && !(status != null && WAKE_RETRY_STATUSES.has(status))) {
      const data = err.response?.data as { error?: string; message?: string } | undefined;
      const msg = data?.error ?? data?.message ?? err.message;
      console.error('[API]', msg);
    }
    return Promise.reject(err);
  },
);
