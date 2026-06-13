import { create } from 'zustand';
import type { HandoutReceiptRecord } from '@grimoire/shared';
import { fetchHandoutJournal } from './handoutApi';
import type { HandoutViewerContent } from '@/systems/compendium/handoutViewerStore';

interface HandoutJournalState {
  entries: HandoutReceiptRecord[];
  loading: boolean;
  loadJournal: (campaignId: string) => Promise<void>;
  upsertEntry: (entry: HandoutReceiptRecord) => void;
  receiptToViewerContent: (entry: HandoutReceiptRecord) => HandoutViewerContent;
}

export const useHandoutJournalStore = create<HandoutJournalState>((set) => ({
  entries: [],
  loading: false,

  async loadJournal(campaignId) {
    set({ loading: true });
    try {
      const entries = await fetchHandoutJournal(campaignId);
      set({ entries, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  upsertEntry(entry) {
    set((s) => {
      const rest = s.entries.filter((e) => e.id !== entry.id);
      return {
        entries: [entry, ...rest].sort(
          (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
        ),
      };
    });
  },

  receiptToViewerContent(entry) {
    const meta = entry.itemMeta;
    return {
      receiptId: entry.id,
      handoutId: entry.handoutId,
      title: entry.title,
      description: entry.content ?? '',
      ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
      handoutType: entry.type,
      ...(meta?.itemType ? { itemType: meta.itemType } : {}),
      ...(meta?.rarity ? { rarity: meta.rarity } : {}),
      ...(meta?.source ? { source: meta.source } : {}),
      ...(meta?.isCustom !== undefined ? { isCustom: meta.isCustom } : {}),
    };
  },
}));
