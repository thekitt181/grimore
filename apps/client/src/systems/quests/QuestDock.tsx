import { useState, useSyncExternalStore } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useQuestStore } from './questStore';

const STORAGE_KEY = 'grimoire-quest-sections';
let collapsedIds = loadCollapsed();
const listeners = new Set<() => void>();

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function toggleCollapsed(id: string) {
  const next = new Set(collapsedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* private mode */
  }
  emit();
}

function useCollapsed(id: string): boolean {
  return useSyncExternalStore(subscribe, () => collapsedIds.has(id), () => false);
}

/** Quest list opened from the bottom-bar icon. Each location folds on its own. */
export function QuestDock() {
  const quests = useQuestStore((s) => s.quests);
  const locations = useQuestStore((s) => s.locations);
  const addLocation = useQuestStore((s) => s.addLocation);
  const removeLocation = useQuestStore((s) => s.removeLocation);
  const isGM = useSessionStore((s) => s.myRole === 'GM');
  const [place, setPlace] = useState('');
  const open = quests.filter((quest) => !quest.done).length;

  return (
    <div
      className="rounded-lg shadow-panel w-[17rem] pointer-events-auto"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="font-display text-xs font-semibold tracking-wider uppercase flex-1" style={{ color: 'var(--color-accent-gold)' }}>
          Quests
        </span>
        <span className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          {open} open
        </span>
      </div>
      <div className="px-2 pb-2 space-y-2 max-h-[46vh] overflow-y-auto">
          {locations.length === 0 && (
            <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {isGM ? 'Add a location, then the quests there.' : 'The DM has not added any quests yet.'}
            </p>
          )}
          {locations.map((location) => (
            <LocationSection
              key={location}
              location={location}
              isGM={isGM}
              onRemove={() => removeLocation(location)}
            />
          ))}
          {isGM && (
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                addLocation(place);
                setPlace('');
              }}
            >
              <input
                className="input-dark flex-1 text-xs py-1"
                placeholder="Add a location..."
                value={place}
                maxLength={40}
                onChange={(event) => setPlace(event.target.value)}
              />
              <button className="btn-primary px-2 py-1 text-xs" type="submit" disabled={!place.trim()}>
                Add
              </button>
            </form>
          )}
      </div>
    </div>
  );
}

function LocationSection({
  location,
  isGM,
  onRemove,
}: {
  location: string;
  isGM: boolean;
  onRemove: () => void;
}) {
  const quests = useQuestStore((s) => s.quests.filter((quest) => quest.location === location));
  const addQuest = useQuestStore((s) => s.addQuest);
  const toggleQuest = useQuestStore((s) => s.toggleQuest);
  const removeQuest = useQuestStore((s) => s.removeQuest);
  const collapsed = useCollapsed(`quest-loc:${location.toLowerCase()}`);
  const [title, setTitle] = useState('');
  const [openQuestId, setOpenQuestId] = useState<string | null>(null);
  const open = quests.filter((quest) => !quest.done).length;

  return (
    <div className="rounded border border-[#2a2a3a]">
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          className="flex flex-1 items-center gap-1.5 text-left min-w-0"
          aria-expanded={!collapsed}
          onClick={() => toggleCollapsed(`quest-loc:${location.toLowerCase()}`)}
        >
          <span className="font-ui text-[10px] w-2.5 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="font-ui text-xs truncate flex-1" style={{ color: 'var(--color-text-primary)' }}>
            {location}
          </span>
          <span className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            {open}/{quests.length}
          </span>
        </button>
        {isGM && (
          <button
            type="button"
            className="text-xs opacity-40 hover:opacity-100"
            style={{ color: 'var(--color-accent-red-hot)' }}
            title="Remove location"
            onClick={onRemove}
          >
            ✕
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="px-1.5 pb-1.5 space-y-1">
          {quests.map((quest) => (
            <div key={quest.id}>
              <div className="flex items-start gap-1.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={quest.done}
                  onChange={() => toggleQuest(quest.id)}
                />
                <button
                  type="button"
                  className="flex flex-1 items-start gap-1 min-w-0 text-left"
                  onClick={() => setOpenQuestId((current) => current === quest.id ? null : quest.id)}
                >
                  <span
                    className="font-ui text-xs leading-snug flex-1"
                    style={{
                      color: quest.done ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                      textDecoration: quest.done ? 'line-through' : undefined,
                    }}
                  >
                    {quest.title}
                  </span>
                  {(quest.notes?.length ?? 0) > 0 && (
                    <span className="font-ui text-[10px] shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                      {quest.notes.length}
                    </span>
                  )}
                </button>
                {isGM && (
                  <button
                    type="button"
                    className="text-xs opacity-40 hover:opacity-100"
                    style={{ color: 'var(--color-accent-red-hot)' }}
                    title="Remove quest"
                    onClick={() => removeQuest(quest.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
              {openQuestId === quest.id && <QuestNotes questId={quest.id} notes={quest.notes ?? []} />}
            </div>
          ))}
          {isGM && (
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                addQuest(location, title);
                setTitle('');
              }}
            >
              <input
                className="input-dark flex-1 text-xs py-1"
                placeholder="Add a quest..."
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
              <button className="btn-ghost px-2 py-1 text-xs" type="submit" disabled={!title.trim()}>
                Add
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function QuestNotes({ questId, notes }: { questId: string; notes: Array<{ id: string; text: string; author: string }> }) {
  const addNote = useQuestStore((s) => s.addNote);
  const removeNote = useQuestStore((s) => s.removeNote);
  const [text, setText] = useState('');

  return (
    <div className="mt-1 ml-5 space-y-1">
      {notes.length === 0 && (
        <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          No notes on this quest yet.
        </p>
      )}
      {notes.map((note) => (
        <div key={note.id} className="flex items-start gap-1.5">
          <p className="font-ui text-xs leading-snug flex-1 min-w-0">
            <span style={{ color: 'var(--color-accent-gold)' }}>{note.author}: </span>
            <span style={{ color: 'var(--color-text-primary)' }}>{note.text}</span>
          </p>
          <button
            type="button"
            className="text-xs opacity-40 hover:opacity-100"
            style={{ color: 'var(--color-accent-red-hot)' }}
            title="Remove note"
            onClick={() => removeNote(questId, note.id)}
          >
            ✕
          </button>
        </div>
      ))}
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          addNote(questId, text);
          setText('');
        }}
      >
        <input
          className="input-dark flex-1 text-xs py-1"
          placeholder="Note progress..."
          value={text}
          maxLength={280}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="btn-ghost px-2 py-1 text-xs" type="submit" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
