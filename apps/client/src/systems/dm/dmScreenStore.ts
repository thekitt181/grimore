import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DmScreenTab = 'party' | 'conditions' | 'encounters' | 'notes' | 'rolls';

interface DmScreenState {
  open: boolean;
  tab: DmScreenTab;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setTab: (tab: DmScreenTab) => void;
}

export const useDmScreenStore = create<DmScreenState>()(
  persist(
    (set) => ({
      open: false,
      tab: 'party',
      setOpen: (open) => set({ open }),
      toggleOpen: () => set((s) => ({ open: !s.open })),
      setTab: (tab) => set({ tab }),
    }),
    {
      name: 'grimoire-dm-screen',
      partialize: (s) => ({ tab: s.tab }),
    },
  ),
);

const notesKey = (sessionId: string) => `grimoire-dm-notes-${sessionId}`;

export function loadDmNotes(sessionId: string): string {
  try {
    return localStorage.getItem(notesKey(sessionId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDmNotes(sessionId: string, text: string): void {
  try {
    localStorage.setItem(notesKey(sessionId), text);
  } catch {
    /* ignore quota */
  }
}
