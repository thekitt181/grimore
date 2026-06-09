import type { QueryClient } from '@tanstack/react-query';
import type { CompendiumImageKind } from '@grimoire/shared';
import type { CompendiumTab } from './compendiumStore';
import { getEntryImages, getItem, getMonster, getSpell } from './compendiumApi';
import { preloadCompendiumImageUrl } from './preloadCompendiumImage';

function kindForTab(tab: CompendiumTab): CompendiumImageKind {
  if (tab === 'monsters') return 'monster';
  if (tab === 'items') return 'item';
  return 'spell';
}

/** Start loading item detail + image metadata before the reference panel opens. */
export function prefetchCompendiumEntry(qc: QueryClient, tab: CompendiumTab, id: string): void {
  if (tab === 'monsters') {
    void qc.prefetchQuery({
      queryKey: ['compendium', 'monster', id],
      queryFn: () => getMonster(id),
      staleTime: 120_000,
    });
  } else if (tab === 'items') {
    void qc.prefetchQuery({
      queryKey: ['compendium', 'item', id],
      queryFn: () => getItem(id),
      staleTime: 120_000,
    });
  } else {
    void qc.prefetchQuery({
      queryKey: ['compendium', 'spell', id],
      queryFn: () => getSpell(id),
      staleTime: 120_000,
    });
  }

  const kind = kindForTab(tab);
  void qc
    .fetchQuery({
      queryKey: ['compendium', kind, id, 'images'],
      queryFn: () => getEntryImages(kind, id),
      staleTime: 120_000,
    })
    .then((state) => {
      preloadCompendiumImageUrl(state.current, state.updatedAt);
    })
    .catch(() => undefined);
}
