import type { QueryClient } from '@tanstack/react-query';
import type { CompendiumImageKind } from '@grimoire/shared';
import type { CompendiumFetchOpts } from './compendiumApi';
import type { CompendiumTab } from './compendiumStore';
import { getEntryImages, getItem, getMonster, getSpell } from './compendiumApi';
import { preloadCompendiumImageUrl } from './preloadCompendiumImage';

function kindForTab(tab: CompendiumTab): CompendiumImageKind {
  if (tab === 'monsters') return 'monster';
  if (tab === 'items') return 'item';
  return 'spell';
}

/** Start loading item detail + image metadata before the reference panel opens. */
export function prefetchCompendiumEntry(
  qc: QueryClient,
  tab: CompendiumTab,
  id: string,
  opts?: CompendiumFetchOpts,
): void {
  const fetchOpts = opts?.source ? { source: opts.source } : undefined;
  if (tab === 'monsters') {
    void qc.prefetchQuery({
      queryKey: ['compendium', 'monster', id, fetchOpts?.source ?? ''],
      queryFn: () => getMonster(id, fetchOpts),
      staleTime: 120_000,
    });
  } else if (tab === 'items') {
    void qc.prefetchQuery({
      queryKey: ['compendium', 'item', id, fetchOpts?.source ?? ''],
      queryFn: () => getItem(id, fetchOpts),
      staleTime: 120_000,
    });
  } else {
    void qc.prefetchQuery({
      queryKey: ['compendium', 'spell', id, fetchOpts?.source ?? ''],
      queryFn: () => getSpell(id, fetchOpts),
      staleTime: 120_000,
    });
  }

  const kind = kindForTab(tab);
  void qc
    .fetchQuery({
      queryKey: ['compendium', kind, id, 'images', fetchOpts?.source ?? ''],
      queryFn: () => getEntryImages(kind, id, fetchOpts),
      staleTime: 120_000,
    })
    .then((state) => {
      preloadCompendiumImageUrl(state.current, state.updatedAt);
    })
    .catch(() => undefined);
}
