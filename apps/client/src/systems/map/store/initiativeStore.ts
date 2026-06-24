import { create } from 'zustand';

export interface Combatant {
  id: string;
  name: string;
  initiative: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  conditions: string[];
  tokenId?: string;
  isPlayer: boolean;
  hideHpFromPlayers?: boolean;
}

interface InitiativeState {
  combatants: Combatant[];
  currentIndex: number;
  isActive: boolean;
  round: number;

  setCombatants:   (cs: Combatant[]) => void;
  addCombatant:    (c: Combatant)    => void;
  removeCombatant: (id: string)      => void;
  updateCombatant: (id: string, updates: Partial<Combatant>) => void;
  setInitiative:   (id: string, initiative: number) => void;
  reorderCombatants: (fromIndex: number, toIndex: number) => void;
  startCombat:     () => void;
  endCombat:       () => void;
  nextTurn:        () => void;
  prevTurn:        () => void;
  syncFromServer:  (payload: { combatants: Combatant[]; currentIndex: number; round: number; isActive: boolean }) => void;
}

export const useInitiativeStore = create<InitiativeState>((set, get) => ({
  combatants:   [],
  currentIndex: 0,
  isActive:     false,
  round:        1,

  setCombatants: (cs) => set({ combatants: [...cs].sort((a, b) => b.initiative - a.initiative) }),

  addCombatant: (c) =>
    set((s) => ({
      combatants: [...s.combatants, c].sort((a, b) => b.initiative - a.initiative),
    })),

  removeCombatant: (id) =>
    set((s) => {
      const combatants = s.combatants.filter((c) => c.id !== id);
      const currentIndex = Math.min(s.currentIndex, Math.max(0, combatants.length - 1));
      return { combatants, currentIndex };
    }),

  updateCombatant: (id, updates) =>
    set((s) => ({
      combatants: s.combatants.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),

  setInitiative: (id, initiative) =>
    set((s) => ({
      combatants: s.combatants
        .map((c) => (c.id === id ? { ...c, initiative } : c))
        .sort((a, b) => b.initiative - a.initiative),
    })),

  reorderCombatants: (fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return s;
      if (fromIndex >= s.combatants.length || toIndex >= s.combatants.length) return s;
      const combatants = [...s.combatants];
      const [moved] = combatants.splice(fromIndex, 1);
      if (!moved) return s;
      combatants.splice(toIndex, 0, moved);
      const currentId = s.combatants[s.currentIndex]?.id;
      const nextIndex = currentId ? combatants.findIndex((c) => c.id === currentId) : 0;
      return { combatants, currentIndex: Math.max(0, nextIndex) };
    }),

  startCombat: () => set({ isActive: true, currentIndex: 0, round: 1 }),
  endCombat:   () => set({ isActive: false, currentIndex: 0, round: 1 }),

  nextTurn: () =>
    set((s) => {
      const len = s.combatants.length;
      if (len === 0) return s;
      const next = (s.currentIndex + 1) % len;
      const round = next === 0 ? s.round + 1 : s.round;
      return { currentIndex: next, round };
    }),

  prevTurn: () =>
    set((s) => {
      const len = s.combatants.length;
      if (len === 0) return s;
      const prev = (s.currentIndex - 1 + len) % len;
      return { currentIndex: prev };
    }),

  syncFromServer: (payload) =>
    set({
      combatants: payload.combatants.map((c) => ({
        ...c,
        tempHp: c.tempHp ?? 0,
      })),
      currentIndex: payload.currentIndex,
      round:        payload.round,
      isActive:     payload.isActive,
    }),
}));
