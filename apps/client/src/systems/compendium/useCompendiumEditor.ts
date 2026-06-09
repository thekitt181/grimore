import { useCompendiumAdminStore } from './compendiumAdminStore';

/** Compendium admin password unlocked (lock/unlock, drafts, publish). */
export function useCompendiumEditor(): boolean {
  return useCompendiumAdminStore((s) => s.unlocked);
}
