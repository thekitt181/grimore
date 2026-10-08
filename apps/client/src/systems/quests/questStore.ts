import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { QuestEntry, QuestNote } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { persistQuestsLocal } from '@/systems/scene/sessionPersistence';

interface QuestState {
  quests: QuestEntry[];
  locations: string[];
  applyFromServer: (quests: QuestEntry[], locations?: string[]) => void;
  addLocation: (name: string) => void;
  addQuest: (location: string, title: string) => void;
  toggleQuest: (id: string) => void;
  removeQuest: (id: string) => void;
  removeLocation: (name: string) => void;
  addNote: (questId: string, text: string) => void;
  removeNote: (questId: string, noteId: string) => void;
}

function samePlace(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const useQuestStore = create<QuestState>((set, get) => ({
  quests: [],
  locations: [],
  applyFromServer: (quests, locations) => {
    const named = locations && locations.length > 0
      ? locations
      : [...new Set(quests.map((quest) => quest.location || 'General'))];
    set({
      quests: quests.map((quest) => ({
        ...quest,
        location: quest.location || 'General',
        notes: quest.notes ?? [],
      })),
      locations: named,
    });
  },
  addLocation: (name) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed || get().locations.some((place) => samePlace(place, trimmed))) return;
    const locations = [...get().locations, trimmed];
    set({ locations });
    emitQuestSync(get().quests, locations);
  },
  addQuest: (location, title) => {
    const trimmed = title.trim().slice(0, 120);
    const place = location.trim().slice(0, 40);
    if (!trimmed || !place) return;
    const locations = get().locations.some((name) => samePlace(name, place))
      ? get().locations
      : [...get().locations, place];
    const quests = [...get().quests, { id: uuidv4(), title: trimmed, location: place, done: false, notes: [] }];
    set({ quests, locations });
    emitQuestSync(quests, locations);
  },
  toggleQuest: (id) => {
    const quests = get().quests.map((quest) => (
      quest.id === id ? { ...quest, done: !quest.done } : quest
    ));
    set({ quests });
    emitQuestSync(quests, get().locations);
  },
  removeQuest: (id) => {
    const quests = get().quests.filter((quest) => quest.id !== id);
    set({ quests });
    emitQuestSync(quests, get().locations);
  },
  removeLocation: (name) => {
    const locations = get().locations.filter((place) => !samePlace(place, name));
    const quests = get().quests.filter((quest) => !samePlace(quest.location, name));
    set({ quests, locations });
    emitQuestSync(quests, locations);
  },
  addNote: (questId, text) => {
    const trimmed = text.trim().slice(0, 280);
    if (!trimmed) return;
    const { myUserId, connectedUsers } = useSessionStore.getState();
    const author = connectedUsers.find((user) => user.id === myUserId)?.username ?? 'Player';
    const note: QuestNote = { id: uuidv4(), text: trimmed, author, at: Date.now() };
    const quests = get().quests.map((quest) => (
      quest.id === questId ? { ...quest, notes: [...(quest.notes ?? []), note] } : quest
    ));
    set({ quests });
    emitQuestSync(quests, get().locations);
  },
  removeNote: (questId, noteId) => {
    const quests = get().quests.map((quest) => (
      quest.id === questId
        ? { ...quest, notes: (quest.notes ?? []).filter((note) => note.id !== noteId) }
        : quest
    ));
    set({ quests });
    emitQuestSync(quests, get().locations);
  },
}));

export function emitQuestSync(quests: QuestEntry[], locations: string[]): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;
  persistQuestsLocal(sessionId, { quests, locations });
  getSocket().emit('quest:sync', { sessionId, quests, locations });
}
