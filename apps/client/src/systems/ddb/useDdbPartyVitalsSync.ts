import { useEffect, useRef } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { syncDdbCharacter } from './ddbApi';
import { pullDdbHpToToken } from './useDdbHpSync';

/** After scene load, sync DDB vitals for every linked PC token once per session visit. */
export function useDdbPartyVitalsSync(sessionReady: boolean): void {
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!sessionReady || syncedRef.current) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runSync = () => {
      if (cancelled || syncedRef.current) return;

      const tokens = Object.values(useItemStore.getState().items).filter(
        (i): i is TokenItem => i.type === 'token' && Boolean(i.ddbCharacterId),
      );
      if (tokens.length === 0) return;

      syncedRef.current = true;
      void Promise.allSettled(
        tokens.map(async (token) => {
          const ch = await syncDdbCharacter(token.ddbCharacterId!);
          pullDdbHpToToken(token.id, ch);
        }),
      );
    };

    timer = setTimeout(runSync, 1500);
    const unsub = useItemStore.subscribe(() => {
      if (!syncedRef.current) runSync();
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [sessionReady]);
}
