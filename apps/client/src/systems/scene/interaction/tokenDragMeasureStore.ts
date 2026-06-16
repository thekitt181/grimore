import { create } from 'zustand';

interface TokenDragMeasureState {
  active: boolean;
  feet: number;
  screenX: number;
  screenY: number;
  setMeasure: (feet: number, screenX: number, screenY: number) => void;
  clear: () => void;
}

export const useTokenDragMeasureStore = create<TokenDragMeasureState>((set) => ({
  active: false,
  feet: 0,
  screenX: 0,
  screenY: 0,
  setMeasure: (feet, screenX, screenY) => set({ active: true, feet, screenX, screenY }),
  clear: () => set({ active: false, feet: 0, screenX: 0, screenY: 0 }),
}));
