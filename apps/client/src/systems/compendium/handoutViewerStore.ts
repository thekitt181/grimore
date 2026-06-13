import { create } from 'zustand';
import type { HandoutType } from '@grimoire/shared';
import type { HandoutItem } from '@/systems/scene/types';

export interface HandoutViewerContent {
  receiptId?: string;
  handoutId?: string;
  title: string;
  description: string;
  imageUrl?: string;
  itemType?: string;
  rarity?: string;
  source?: string;
  isCustom?: boolean;
  handoutType?: HandoutType;
  animate?: boolean;
}

interface HandoutViewerState {
  content: HandoutViewerContent | null;
  openHandout: (handout: HandoutItem) => void;
  openContent: (content: HandoutViewerContent) => void;
  close: () => void;
}

export const useHandoutViewerStore = create<HandoutViewerState>((set) => ({
  content: null,
  openHandout: (handout) => set({
    content: {
      title: handout.name,
      description: handout.description,
      handoutType: 'ITEM_CARD',
      ...(handout.imageUrl ? { imageUrl: handout.imageUrl } : {}),
      ...(handout.itemType ? { itemType: handout.itemType } : {}),
      ...(handout.rarity ? { rarity: handout.rarity } : {}),
      ...(handout.source ? { source: handout.source } : {}),
    },
  }),
  openContent: (content) => set({ content }),
  close: () => set({ content: null }),
}));
