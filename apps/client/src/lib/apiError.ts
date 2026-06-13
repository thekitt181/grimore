import axios from 'axios';

export function extractApiError(err: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    const serverMsg = data?.error ?? data?.message;
    if (serverMsg) return serverMsg;
    const status = err.response?.status;
    if (!err.response) return 'Cannot reach the server — check your connection or wait for Render to wake up';
    if (status === 400) return 'Bad request — check D&D Beyond link and import selection';
    if (status === 401) return 'Session expired — sign in again';
    if (status === 503) return 'Server is starting — retry in a moment';
    if (status === 502 || status === 504) {
      return 'Server timed out — try importing fewer entries at a time';
    }
  }
  if (err instanceof Error && err.message && !err.message.startsWith('Request failed with status code')) {
    return err.message;
  }
  return fallback;
}
