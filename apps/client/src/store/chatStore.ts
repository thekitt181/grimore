import { create } from 'zustand';
import type { ChatMessagePayload } from '@grimoire/shared';

interface ChatState {
  messages: ChatMessagePayload[];
  addMessage: (message: ChatMessagePayload) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (message) =>
    set((state) => ({
      // Keep max 200 messages in memory
      messages: [...state.messages.slice(-199), message],
    })),
  clearMessages: () => set({ messages: [] }),
}));
