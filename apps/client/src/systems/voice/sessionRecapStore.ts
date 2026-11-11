import { create } from 'zustand';
import {
  EMPTY_SESSION_RECAP,
  type RecapLine,
  type SessionRecapDoc,
} from '@grimoire/shared';

interface RecapState {
  open: boolean;
  lines: RecapLine[];
  recap: SessionRecapDoc;
  scribeOn: boolean;
  scribeError: string | null;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setScribeOn: (scribeOn: boolean) => void;
  setScribeError: (scribeError: string | null) => void;
  addLine: (line: RecapLine) => void;
  applySync: (recap: SessionRecapDoc, lines: RecapLine[]) => void;
  reset: () => void;
}

export const useSessionRecapStore = create<RecapState>((set) => ({
  open: false,
  lines: [],
  recap: EMPTY_SESSION_RECAP,
  scribeOn: false,
  scribeError: null,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((s) => ({ open: !s.open })),
  setScribeOn: (scribeOn) => set({ scribeOn }),
  setScribeError: (scribeError) => set({ scribeError }),
  addLine: (line) =>
    set((s) => {
      if (s.lines.some((l) => l.id === line.id)) return s;
      return { lines: [...s.lines.slice(-499), line] };
    }),
  applySync: (recap, lines) => set({ recap, lines }),
  reset: () => set({ lines: [], recap: EMPTY_SESSION_RECAP, scribeOn: false, scribeError: null }),
}));
