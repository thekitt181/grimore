import axios from 'axios';

export function extractApiError(err: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    const serverMsg = data?.error ?? data?.message;
    if (serverMsg) return serverMsg;
    if (!err.response) {
      const code = err.code ?? '';
      if (code === 'ECONNREFUSED' || code === 'ERR_NETWORK') {
        return 'Cannot reach the API server — wait a moment and try again (dev server may be restarting).';
      }
      if (code === 'ECONNRESET') {
        return 'Connection to the server was interrupted — retry in a moment.';
      }
      return 'Cannot reach the server — check your connection or wait for Render to wake up';
    }
    const status = err.response.status;
    if (status === 400) return data?.error ?? 'D&D Beyond rejected the request — check your linked account and character.';
    if (status === 401) return 'Session expired — sign in again';
    if (status === 404) return data?.error ?? 'Not found on D&D Beyond — check the encounter URL or save it to your campaign first';
    if (status === 502 || status === 504) {
      return data?.error ?? 'Server timed out — retry in a moment';
    }
  }
  if (err instanceof Error && err.message && !err.message.startsWith('Request failed with status code')) {
    return err.message;
  }
  return fallback;
}
