import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CompendiumAdminState {
  password: string | null;
  unlocked: boolean;
  setPassword: (password: string | null) => void;
  unlock: (password: string) => void;
  lock: () => void;
}

export const useCompendiumAdminStore = create<CompendiumAdminState>()(
  persist(
    (set) => ({
      password: null,
      unlocked: false,
      setPassword: (password) => set({ password, unlocked: Boolean(password) }),
      unlock: (password) => set({ password, unlocked: true }),
      lock: () => set({ password: null, unlocked: false }),
    }),
    { name: 'grimoire-compendium-admin' },
  ),
);

export function getCompendiumAdminPassword(): string | null {
  return useCompendiumAdminStore.getState().password;
}
