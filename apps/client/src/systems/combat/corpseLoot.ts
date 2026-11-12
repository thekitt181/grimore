import { create } from 'zustand';
import type { GrimoireCharacter } from '@grimoire/shared';
import type { TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { LootDrop } from '@/systems/compendium/compendiumApi';
import { giveDdbGold, giveDdbInventoryItem } from '@/systems/ddb/ddbApi';

export interface CorpseLoot {
  gold: number;
  items: Array<{ name: string; quantity: number }>;
  drops?: LootDrop[];
  claimed?: boolean;
}

interface CorpseLootUi {
  tokenId: string | null;
  open: (tokenId: string) => void;
  close: () => void;
}

export const useCorpseLootUi = create<CorpseLootUi>((set) => ({
  tokenId: null,
  open: (tokenId) => set({ tokenId }),
  close: () => set({ tokenId: null }),
}));

export function isWandererCorpseCandidate(token: TokenItem): boolean {
  if (token.isPc || token.ddbCharacterId) return false;
  return Boolean(token.wanderChosen || token.wandering || token.monsterId);
}

export type CoinShare = {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
};

const EMPTY_COINS: CoinShare = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

export function parseCoins(label: string): CoinShare {
  const coins = { ...EMPTY_COINS };
  const re = /(\d+)\s*(pp|gp|ep|sp|cp)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label)) !== null) {
    const n = parseInt(m[1]!, 10);
    const k = m[2]!.toLowerCase() as keyof CoinShare;
    if (Number.isFinite(n)) coins[k] += n;
  }
  if (coins.cp + coins.sp + coins.ep + coins.gp + coins.pp === 0) {
    const gold = label.replace(/,/g, '').match(/(\d+)\s*gold/i);
    if (gold) coins.gp = parseInt(gold[1]!, 10);
  }
  return coins;
}

export function parseGoldLabel(label: string): number {
  return parseCoins(label).gp;
}

/** Official D&D Beyond name for a drop; reflavors keep table name in the notes. */
export function ddbGiveFromDrop(
  drop: LootDrop,
  lootedFrom: string,
): { name: string; description: string; itemType?: string } | null {
  if (drop.kind === 'currency') return null;
  if (drop.kind === 'item' && drop.reflavoredFrom) {
    return {
      name: drop.reflavoredFrom,
      description: `Table name: ${drop.name}. Official item: ${drop.reflavoredFrom}. Looted from ${lootedFrom}.`,
      ...(drop.type ? { itemType: drop.type } : {}),
    };
  }
  return {
    name: drop.name,
    description: `Looted from ${lootedFrom}.`,
    ...(drop.kind === 'item' && drop.type ? { itemType: drop.type } : {}),
  };
}

export function parseItemStack(raw: string): { name: string; quantity: number } {
  const text = raw.trim();
  const m = text.match(/^(.*?)\s*[×x]\s*(\d+)\s*$/i)
    ?? text.match(/^(.*?)\s*\((\d+)\)\s*$/);
  if (m) {
    const quantity = Math.max(1, parseInt(m[2]!, 10) || 1);
    const name = m[1]!.trim() || text;
    return { name, quantity };
  }
  return { name: text, quantity: 1 };
}

export function splitShares(total: number, parts: number): number[] {
  const n = Math.max(1, parts);
  const qty = Math.max(0, Math.floor(total));
  const base = Math.floor(qty / n);
  const rem = qty % n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

function compactCoins(share: CoinShare): Partial<CoinShare> {
  const out: Partial<CoinShare> = {};
  (['pp', 'gp', 'ep', 'sp', 'cp'] as const).forEach((k) => {
    if (share[k] > 0) out[k] = share[k];
  });
  return out;
}

function coinTotal(share: Partial<CoinShare>): number {
  return (['cp', 'sp', 'ep', 'gp', 'pp'] as const)
    .reduce((sum, k) => sum + Math.max(0, share[k] ?? 0), 0);
}

type SceneCorpseLoot = NonNullable<TokenItem['corpseLoot']>;
type SceneDrop = NonNullable<SceneCorpseLoot['drops']>[number];

function normalizeDrop(drop: SceneDrop): LootDrop {
  if (drop.kind === 'currency') return { kind: 'currency', label: drop.label };
  if (drop.kind === 'item') {
    return {
      kind: 'item',
      id: drop.id ?? '',
      name: drop.name,
      type: drop.type ?? '',
      ...(drop.rarity ? { rarity: drop.rarity } : {}),
      ...(drop.source ? { source: drop.source } : {}),
      ...(drop.reflavoredFrom ? { reflavoredFrom: drop.reflavoredFrom } : {}),
    };
  }
  return { kind: 'flavor', name: drop.name, detail: drop.detail ?? '' };
}

export function corpseDrops(loot: TokenItem['corpseLoot'] | CorpseLoot | undefined): LootDrop[] {
  if (!loot) return [];
  if (loot.drops && loot.drops.length > 0) return loot.drops.map(normalizeDrop);
  const out: LootDrop[] = [];
  if (loot.gold > 0) out.push({ kind: 'currency', label: `${loot.gold} gp` });
  for (const it of loot.items ?? []) {
    out.push({ kind: 'flavor', name: it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name, detail: '' });
  }
  return out;
}

export function packCorpseLoot(drops: LootDrop[], claimed = false): CorpseLoot {
  let gold = 0;
  const items: Array<{ name: string; quantity: number }> = [];
  for (const drop of drops) {
    if (drop.kind === 'currency') gold += parseGoldLabel(drop.label);
    else items.push({ name: drop.name, quantity: 1 });
  }
  return { gold, items, drops, claimed };
}

function writeCorpseLoot(tokenId: string, loot: CorpseLoot): void {
  useItemStore.getState().updateItem(tokenId, {
    corpseLoot: loot,
    wandering: false,
    wanderChosen: false,
  });
  emitItemUpdate([{
    id: tokenId,
    patch: { corpseLoot: loot, wandering: false, wanderChosen: false },
  }]);
}

export function setCorpseLootDrops(tokenId: string, drops: LootDrop[], claimed = false): void {
  writeCorpseLoot(tokenId, packCorpseLoot(drops, claimed));
}

const rolling = new Set<string>();

function hasUnclaimedLoot(item: TokenItem): boolean {
  return Boolean(item.corpseLoot && !item.corpseLoot.claimed);
}

/** Stamp an empty (or existing) corpse so the GM can roll; do not auto-roll. */
export async function ensureCorpseLoot(
  tokenId: string,
  opts?: { replaceClaimed?: boolean },
): Promise<void> {
  const item = useItemStore.getState().items[tokenId];
  if (!item || item.type !== 'token') return;
  if (!isWandererCorpseCandidate(item)) return;
  if (item.hp > 0) return;
  if (hasUnclaimedLoot(item) || rolling.has(tokenId)) return;
  if (item.corpseLoot && !opts?.replaceClaimed) return;

  rolling.add(tokenId);
  try {
    const live = useItemStore.getState().items[tokenId];
    if (!live || live.type !== 'token' || live.hp > 0) return;
    if (hasUnclaimedLoot(live)) return;
    writeCorpseLoot(tokenId, packCorpseLoot([], false));
  } finally {
    rolling.delete(tokenId);
  }
}

export function maybeSpawnCorpse(tokenId: string, prevHp: number, nextHp: number): void {
  if (!(prevHp > 0 && nextHp <= 0)) return;
  const item = useItemStore.getState().items[tokenId];
  if (item?.type === 'token' && hasUnclaimedLoot(item)) return;
  void ensureCorpseLoot(tokenId, { replaceClaimed: true });
}

export async function takeCorpseLoot(
  token: TokenItem,
  ddbCharacterId: number,
  selected: LootDrop[],
): Promise<{ ok: boolean; message: string; character?: GrimoireCharacter }> {
  const loot = token.corpseLoot;
  if (!loot || loot.claimed) return { ok: false, message: 'Already looted' };
  if (selected.length === 0) return { ok: false, message: 'Tick the drops to give' };

  const lines: string[] = [];
  let character: GrimoireCharacter | undefined;
  const items: Array<{ name: string; quantity: number; description: string; itemType?: string }> = [];
  const purse: CoinShare = { ...EMPTY_COINS };
  for (const drop of selected) {
    if (drop.kind === 'currency') {
      const coins = parseCoins(drop.label);
      purse.cp += coins.cp;
      purse.sp += coins.sp;
      purse.ep += coins.ep;
      purse.gp += coins.gp;
      purse.pp += coins.pp;
    } else {
      const give = ddbGiveFromDrop(drop, token.name);
      if (!give) continue;
      const stack = parseItemStack(drop.name);
      items.push({
        name: give.name,
        description: give.description,
        quantity: stack.quantity,
        ...(give.itemType ? { itemType: give.itemType } : {}),
      });
    }
  }

  let goldFailed = false;
  if (coinTotal(purse) > 0) {
    const given = await giveDdbGold(ddbCharacterId, compactCoins(purse));
    lines.push(given.message);
    character = given.character;
    goldFailed = !given.pushedToDdb;
  }
  for (const it of items) {
    const given = await giveDdbInventoryItem(ddbCharacterId, {
      name: it.name,
      description: it.description,
      ...(it.itemType ? { itemType: it.itemType } : {}),
      ...(it.quantity > 1 ? { quantity: it.quantity } : {}),
    });
    lines.push(given.message);
    character = given.character;
  }

  const selectedKey = (d: LootDrop) => (d.kind === 'currency' ? `c:${d.label}` : `i:${d.name}`);
  const taken = new Map<string, number>();
  for (const drop of selected) {
    if (goldFailed && drop.kind === 'currency') continue;
    const key = selectedKey(drop);
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  const remaining: LootDrop[] = [];
  for (const drop of corpseDrops(loot)) {
    const key = selectedKey(drop);
    const n = taken.get(key) ?? 0;
    if (n > 0) {
      taken.set(key, n - 1);
      continue;
    }
    remaining.push(drop);
  }

  writeCorpseLoot(token.id, packCorpseLoot(remaining, remaining.length === 0));
  return { ok: true, message: lines.filter(Boolean).join(' · ') || 'Taken', ...(character ? { character } : {}) };
}

export async function splitCorpseLoot(
  token: TokenItem,
  recipients: Array<{ ddbCharacterId: number; name: string }>,
  selected: LootDrop[],
): Promise<{ ok: boolean; message: string; leftover: LootDrop[] }> {
  const loot = token.corpseLoot;
  if (!loot || loot.claimed) return { ok: false, message: 'Already looted', leftover: selected };
  if (selected.length === 0) return { ok: false, message: 'Tick the drops to split', leftover: [] };
  if (recipients.length < 2) return { ok: false, message: 'Tick at least two players to split', leftover: selected };

  const n = recipients.length;
  const leftover: LootDrop[] = [];
  const purses: CoinShare[] = recipients.map(() => ({ ...EMPTY_COINS }));
  const stacks: Array<Array<{ name: string; quantity: number; description: string; itemType?: string }>> = recipients.map(() => []);
  let splitAny = false;

  for (const drop of selected) {
    if (drop.kind === 'currency') {
      const coins = parseCoins(drop.label);
      (['pp', 'gp', 'ep', 'sp', 'cp'] as const).forEach((k) => {
        const shares = splitShares(coins[k], n);
        shares.forEach((share, i) => {
          purses[i]![k] += share;
          if (share > 0) splitAny = true;
        });
      });
      continue;
    }
    const give = ddbGiveFromDrop(drop, token.name);
    const stack = parseItemStack(drop.name);
    if (!give || stack.quantity <= 1) {
      leftover.push(drop);
      continue;
    }
    const shares = splitShares(stack.quantity, n);
    shares.forEach((share, i) => {
      if (share <= 0) return;
      splitAny = true;
      stacks[i]!.push({
        name: give.name,
        quantity: share,
        description: `${give.description} (split)`,
        ...(give.itemType ? { itemType: give.itemType } : {}),
      });
    });
  }

  if (!splitAny) {
    return {
      ok: false,
      message: leftover.length > 0
        ? 'Those items have no quantity to split — give each to one player.'
        : 'Nothing to split',
      leftover,
    };
  }

  const lines: string[] = [];
  let goldFailed = false;
  for (let i = 0; i < n; i += 1) {
    const pc = recipients[i]!;
    const bits: string[] = [];
    if (coinTotal(purses[i]!) > 0) {
      const given = await giveDdbGold(pc.ddbCharacterId, compactCoins(purses[i]!));
      bits.push(given.message);
      if (!given.pushedToDdb) goldFailed = true;
    }
    for (const it of stacks[i]!) {
      const given = await giveDdbInventoryItem(pc.ddbCharacterId, {
        name: it.name,
        description: it.description,
        ...(it.itemType ? { itemType: it.itemType } : {}),
        ...(it.quantity > 1 ? { quantity: it.quantity } : {}),
      });
      bits.push(given.ok ? `${it.quantity}× ${it.name}` : given.message);
    }
    if (bits.length > 0) lines.push(`${pc.name}: ${bits.join(', ')}`);
  }

  const leftoverKeys = new Set(leftover.map((d) => (d.kind === 'currency' ? `c:${d.label}` : `i:${d.name}`)));
  const selectedKey = (d: LootDrop) => (d.kind === 'currency' ? `c:${d.label}` : `i:${d.name}`);
  const taken = new Map<string, number>();
  for (const drop of selected) {
    const key = selectedKey(drop);
    if (leftoverKeys.has(key)) continue;
    if (goldFailed && drop.kind === 'currency') continue;
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  const remaining: LootDrop[] = [];
  for (const drop of corpseDrops(loot)) {
    const key = selectedKey(drop);
    const count = taken.get(key) ?? 0;
    if (count > 0) {
      taken.set(key, count - 1);
      continue;
    }
    remaining.push(drop);
  }

  writeCorpseLoot(token.id, packCorpseLoot(remaining, remaining.length === 0));
  return {
    ok: true,
    message: lines.join(' · ') || 'Split',
    leftover,
  };
}
