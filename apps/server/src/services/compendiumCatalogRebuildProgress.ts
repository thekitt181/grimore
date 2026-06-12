import type { CatalogRebuildProgress } from '@grimoire/shared';
import { broadcastCatalogRebuildProgress } from './compendiumBroadcast';

let progress: CatalogRebuildProgress | null = null;
let lastBroadcastAt = 0;

export function getCatalogRebuildProgress(): CatalogRebuildProgress | null {
  return progress?.active ? progress : null;
}

function emit(force = false): void {
  if (!progress) return;
  const now = Date.now();
  if (!force && now - lastBroadcastAt < 300) return;
  lastBroadcastAt = now;
  broadcastCatalogRebuildProgress(progress);
}

export function startCatalogRebuild(importCounts?: {
  monsters: number;
  items: number;
  spells: number;
}): void {
  const totalImports = importCounts
    ? importCounts.monsters + importCounts.items + importCounts.spells
    : 0;
  const importHint =
    totalImports > 0
      ? ` (${[
          importCounts!.monsters > 0 ? `${importCounts!.monsters.toLocaleString()} monsters` : '',
          importCounts!.spells > 0 ? `${importCounts!.spells.toLocaleString()} spells` : '',
          importCounts!.items > 0 ? `${importCounts!.items.toLocaleString()} items` : '',
        ]
          .filter(Boolean)
          .join(', ')})`
      : '';
  progress = {
    active: true,
    phase: 'starting',
    label: `Rebuilding compendium catalog${importHint}…`,
    percent: 0,
    startedAt: new Date().toISOString(),
    ...(importCounts ? { importCounts } : {}),
  };
  emit(true);
}

export function updateCatalogRebuild(
  patch: Partial<
    Pick<CatalogRebuildProgress, 'phase' | 'label' | 'percent' | 'entryCounts'>
  >,
): void {
  if (!progress?.active) return;
  progress = { ...progress, ...patch };
  emit(false);
}

export function finishCatalogRebuild(
  entryCounts?: { monsters: number; items: number; spells: number },
): void {
  if (!progress) return;
  const done: CatalogRebuildProgress = {
    ...progress,
    active: false,
    phase: 'complete',
    label: entryCounts
      ? `Catalog ready — ${(entryCounts.monsters + entryCounts.items + entryCounts.spells).toLocaleString()} entries`
      : 'Catalog ready',
    percent: 100,
    ...(entryCounts ? { entryCounts } : {}),
  };
  broadcastCatalogRebuildProgress(done);
  progress = null;
}
