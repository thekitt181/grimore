import { useEffect, useState } from 'react';
import { getServerOrigin } from '@/lib/appUrls';

/** null = still loading; false = server has no Google OAuth env vars. */
export function useGoogleOAuthAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${getServerOrigin()}/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { auth?: { googleOAuth?: boolean } } | null) => {
        if (!cancelled) setAvailable(Boolean(data?.auth?.googleOAuth));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
