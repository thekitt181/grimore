import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useQueryClient } from '@tanstack/react-query';
import { isApiAuthBlocked } from '@/lib/apiAuthState';
import { ensureApiAuthSession } from '@/lib/axios';

async function refetchCompendiumCatalog(qc: ReturnType<typeof useQueryClient>): Promise<void> {
  if (isApiAuthBlocked()) return;
  const ok = await ensureApiAuthSession();
  if (!ok) return;
  await qc.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'compendium',
  });
  await qc.refetchQueries({
    predicate: (query) => query.queryKey[0] === 'compendium',
    type: 'active',
  });
}

/** After a stale Clerk token (401), reload compendium data once auth is healthy again. */
export function useCompendiumAuthRecovery(enabled = true): void {
  const { isLoaded, isSignedIn } = useAuth();
  const qc = useQueryClient();
  const recoveringRef = useRef(false);
  const authStaleRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isLoaded || !isSignedIn) return;

    const recover = async () => {
      if (recoveringRef.current || isApiAuthBlocked()) return;
      recoveringRef.current = true;
      try {
        const ok = await ensureApiAuthSession(true);
        if (!ok) return;
        authStaleRef.current = false;
        await refetchCompendiumCatalog(qc);
      } finally {
        recoveringRef.current = false;
      }
    };

    const onExpired = () => {
      authStaleRef.current = true;
    };

    const onRecovered = () => {
      if (!authStaleRef.current) return;
      void recover();
    };

    const onFocus = () => {
      if (!authStaleRef.current) return;
      void recover();
    };

    window.addEventListener('grimoire:auth-expired', onExpired);
    window.addEventListener('grimoire:auth-recovered', onRecovered);
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('grimoire:auth-expired', onExpired);
      window.removeEventListener('grimoire:auth-recovered', onRecovered);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, isLoaded, isSignedIn, qc]);
}

export async function reloadCompendiumCatalog(
  qc: ReturnType<typeof useQueryClient>,
): Promise<boolean> {
  const ok = await ensureApiAuthSession(true);
  if (!ok) return false;
  await refetchCompendiumCatalog(qc);
  return true;
}
