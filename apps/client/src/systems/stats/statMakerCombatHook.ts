/**
 * Watch initiative HP — credit defeats / downs / rounds to token-assigned players.
 * Rounds always sync from the initiative round number for every connected player.
 */
import { useInitiativeStore, type Combatant } from '@/systems/map/store/initiativeStore';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { isPlayerCharacterToken } from '@/systems/scene/token/clientTokenVisibility';
import {
  playerStatTarget,
  recordCreatureDefeated,
  recordLocalDowned,
  resolveStatUserRef,
  syncInitiativeRoundToAllPlayerStats,
  useStatMakerStore,
  type StatUserRef,
} from './statMaker';

let bound = false;
let prevById = new Map<string, { hp: number; isPlayer: boolean; name: string }>();
let prevRound = -1;
let prevActive = false;

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Resolve a combatant to a player stats target via token owner / PC / name match. */
function combatantPlayerRef(c: Combatant): StatUserRef | null {
  const { connectedUsers, myUserId, myRole } = useSessionStore.getState();

  if (c.tokenId) {
    const item = useItemStore.getState().items[c.tokenId];
    if (item?.type === 'token') {
      const ownerId = item.ownerId?.trim();
      if (ownerId) {
        const user = connectedUsers.find((u) => u.id === ownerId);
        if (user?.role === 'GM') return null;
        if (!(myRole === 'GM' && myUserId && ownerId === myUserId)) {
          const ref = playerStatTarget(resolveStatUserRef(ownerId, user?.username || item.name));
          if (ref) return ref;
        }
      }

      if (c.isPlayer || isPlayerCharacterToken(item)) {
        const want = nameKey(item.name || c.name);
        const live = connectedUsers.find(
          (u) => u.role === 'PLAYER' && nameKey(u.username) === want,
        );
        if (live) {
          return playerStatTarget({ userId: live.id, userName: live.username });
        }
      }
    }
  }

  if (c.isPlayer) {
    const want = nameKey(c.name);
    const live = connectedUsers.find(
      (u) => u.role === 'PLAYER' && nameKey(u.username) === want,
    );
    if (live) return playerStatTarget({ userId: live.id, userName: live.username });
  }

  return null;
}

function isMonsterCombatant(c: Combatant): boolean {
  if (c.isPlayer) return false;
  if (!c.tokenId) return true;
  const item = useItemStore.getState().items[c.tokenId];
  if (!item || item.type !== 'token') return true;
  if (item.ownerId?.trim()) return false;
  if (isPlayerCharacterToken(item)) return false;
  return true;
}

function partyStatRefs(combatants: Combatant[]): StatUserRef[] {
  const map = new Map<string, StatUserRef>();
  for (const c of combatants) {
    const ref = combatantPlayerRef(c);
    if (ref) map.set(ref.userId, ref);
  }
  if (map.size === 0) {
    for (const u of useSessionStore.getState().connectedUsers) {
      if (u.role !== 'PLAYER') continue;
      const ref = playerStatTarget({ userId: u.id, userName: u.username });
      if (ref) map.set(ref.userId, ref);
    }
  }
  return [...map.values()];
}

function killCreditRefs(combatants: Combatant[], currentIndex: number, party: StatUserRef[]): StatUserRef[] {
  const current = combatants[currentIndex];
  if (current) {
    const ref = combatantPlayerRef(current);
    if (ref) return [ref];
  }
  return party;
}

function isCombatStatsAuthority(): boolean {
  const { myRole, connectedUsers } = useSessionStore.getState();
  if (myRole === 'GM') return true;
  return !connectedUsers.some((u) => u.role === 'GM');
}

function onInitiativeSnapshot(): void {
  const { combatants, isActive, round, currentIndex } = useInitiativeStore.getState();
  if (useSessionStore.getState().myRole !== 'GM') {
    useStatMakerStore.getState().ensureLocalDoc();
  }

  if (!isActive) {
    prevById = new Map(
      combatants.map((c) => [c.id, { hp: Math.max(0, c.hp), isPlayer: c.isPlayer, name: c.name }]),
    );
    prevActive = false;
    prevRound = round;
    return;
  }

  const authority = isCombatStatsAuthority();

  // Rounds follow initiative on every client (store is already socket-synced).
  if (round >= 1 && (round !== prevRound || !prevActive)) {
    syncInitiativeRoundToAllPlayerStats(round);
  }

  if (authority) {
    const party = partyStatRefs(combatants);
    for (const c of combatants) {
      const prev = prevById.get(c.id);
      const hp = Math.max(0, c.hp);
      if (!(prev && prev.hp > 0 && hp <= 0)) continue;

      const asPlayer = combatantPlayerRef(c);
      if (asPlayer) {
        recordLocalDowned(asPlayer, `down:${c.id}:${round}`);
        continue;
      }

      if (!isMonsterCombatant(c)) continue;
      if (party.length === 0) continue;

      for (const ref of killCreditRefs(combatants, currentIndex, party)) {
        recordCreatureDefeated({
          combatantId: c.id,
          name: c.name,
          round,
          forUser: ref,
        });
      }
    }
  }

  prevById = new Map(
    combatants.map((c) => [c.id, { hp: Math.max(0, c.hp), isPlayer: c.isPlayer, name: c.name }]),
  );
  prevRound = round;
  prevActive = true;
}

let unsubInitiative: (() => void) | null = null;

/** Idempotent — call once from SessionPage (safe across HMR). */
export function bindStatMakerCombatHook(): () => void {
  if (bound && unsubInitiative) {
    onInitiativeSnapshot();
    return () => undefined;
  }
  unsubInitiative?.();
  bound = true;
  onInitiativeSnapshot();
  unsubInitiative = useInitiativeStore.subscribe(onInitiativeSnapshot);
  return () => {
    unsubInitiative?.();
    unsubInitiative = null;
    bound = false;
    prevById = new Map();
    prevRound = -1;
    prevActive = false;
  };
}
