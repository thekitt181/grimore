import { useSpellEffectTargetStore } from './spellEffectTargetStore';

let resolvePick: ((ids: string[]) => void) | null = null;

export function isSpellTargetPicking(): boolean {
  return useSpellEffectTargetStore.getState().pick !== null;
}

export function pickSpellTargets(opts: {
  casterTokenId: string;
  casterName: string;
  spellName: string;
  maxTargets: number;
  castLevel?: number;
  projectileCount?: number;
  allowRepeatTargets?: boolean;
}): Promise<string[]> {
  if (opts.maxTargets <= 0) return Promise.resolve([]);

  if (resolvePick) {
    const stale = resolvePick;
    resolvePick = null;
    stale([]);
  }
  useSpellEffectTargetStore.getState().clearPick();

  return new Promise((resolve) => {
    resolvePick = resolve;
    useSpellEffectTargetStore.getState().beginPick(opts);
  });
}

export function finishSpellTargetPick(ids: string[]): void {
  const resolve = resolvePick;
  resolvePick = null;
  useSpellEffectTargetStore.getState().clearPick();
  resolve?.(ids);
}

export function cancelSpellTargetPick(): void {
  finishSpellTargetPick([]);
}

/** Select one target with a brief highlight flash before resolving. */
export function confirmSingleSpellTarget(tokenId: string): void {
  useSpellEffectTargetStore.getState().toggleTarget(tokenId);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      finishSpellTargetPick([tokenId]);
    });
  });
}
