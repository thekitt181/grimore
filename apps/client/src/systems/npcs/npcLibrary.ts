import { NPC_CATALOG } from './npcCatalog';
import { characterKeywords } from './characterQuery';
import { composeNpc } from './composeNpc';
import type { NpcEntry, NpcPortrait, NpcRecord } from './npcTypes';

const STORAGE_KEY = 'grimoire:npc-codex';

interface NpcLibrarySave {
  portraits: Record<string, NpcPortrait>;
  custom: NpcEntry[];
}

function emptySave(): NpcLibrarySave {
  return { portraits: {}, custom: [] };
}

function loadSave(): NpcLibrarySave {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySave();
    const parsed = JSON.parse(raw) as Partial<NpcLibrarySave>;
    return {
      portraits: parsed.portraits ?? {},
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    };
  } catch {
    return emptySave();
  }
}

function writeSave(save: NpcLibrarySave) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
}

export function listNpcs(): NpcRecord[] {
  const save = loadSave();
  const builtIn = NPC_CATALOG.map((npc) => {
    const portrait = save.portraits[npc.id];
    return portrait ? { ...npc, portrait } : npc;
  });
  const custom = save.custom.map((npc) => {
    const portrait = save.portraits[npc.id];
    return portrait ? { ...npc, custom: true as const, portrait } : { ...npc, custom: true as const };
  });
  return [...custom, ...builtIn];
}

export function searchNpcs(query: string): NpcRecord[] {
  const keywords = characterKeywords(query);
  const all = listNpcs();
  if (keywords.length === 0) return all;
  return all
    .map((npc) => ({ npc, score: scoreNpc(npc, keywords) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.npc);
}

function scoreNpc(npc: NpcRecord, keywords: string[]): number {
  const blob = [
    npc.name,
    npc.role,
    npc.ancestry,
    npc.tags.join(' '),
    npc.appearance,
    npc.personality,
    npc.hook,
    npc.prompt ?? '',
  ].join(' ').toLowerCase();
  return keywords.reduce((score, word) => score + (blob.includes(word) ? 1 : 0), 0);
}

/** A person made from the search, or the saved copy if this search was opened before. */
export function npcForSearch(query: string): NpcRecord | null {
  const made = composeNpc(query);
  if (!made) return null;
  const q = query.trim().toLowerCase();
  const all = listNpcs();
  if (q.length >= 3 && all.some((npc) => npc.name.toLowerCase().includes(q))) return null;
  return all.find((npc) => npc.prompt === made.prompt) ?? made;
}

export function saveNpcPortrait(id: string, portrait: NpcPortrait) {
  const save = loadSave();
  save.portraits[id] = portrait;
  writeSave(save);
}

export function clearNpcPortrait(id: string) {
  const save = loadSave();
  if (!save.portraits[id]) return;
  delete save.portraits[id];
  writeSave(save);
}

export function saveCustomNpc(npc: NpcEntry) {
  const save = loadSave();
  const next = { ...npc, custom: true };
  const index = save.custom.findIndex((entry) => entry.id === npc.id);
  if (index >= 0) save.custom[index] = next;
  else save.custom.unshift(next);
  writeSave(save);
}

export function deleteCustomNpc(id: string) {
  const save = loadSave();
  save.custom = save.custom.filter((entry) => entry.id !== id);
  delete save.portraits[id];
  writeSave(save);
}
