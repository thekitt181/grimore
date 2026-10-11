import { useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ToolSection } from '@/systems/map/ToolSection';
import { clearNpcPortrait, deleteCustomNpc, listNpcs, npcForSearch, saveCustomNpc, saveNpcPortrait, searchNpcs } from './npcLibrary';
import { portraitMatches, portraitSearchText, searchNpcPortraits, suggestNpcPortrait } from './searchNpcPortraits';
import { summonNpc } from './summonNpc';
import type { NpcEntry, NpcPortrait, NpcRecord } from './npcTypes';

const TAGS = ['town', 'road', 'wild', 'noble', 'underworld', 'faith', 'war', 'sea', 'arcane', 'craft'];

function npcProse(npc: { appearance: string; personality: string; hook: string; attack: string }): string {
  return [npc.appearance, npc.personality, npc.hook, npc.attack].filter(Boolean).join(' ');
}

function blankNpc(): NpcEntry {
  return {
    id: `npc-${uuidv4()}`,
    name: '',
    role: '',
    ancestry: '',
    tags: ['town'],
    appearance: '',
    personality: '',
    voice: '',
    hook: '',
    secret: '',
    ac: 12,
    hp: 12,
    attack: '',
    custom: true,
  };
}

export function NpcCodexPanel() {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NpcEntry | null>(null);
  const [message, setMessage] = useState('');

  const npcs = useMemo(() => {
    const found = searchNpcs(query);
    return tag ? found.filter((npc) => npc.tags.includes(tag)) : found;
  }, [query, tag, revision]);

  const preview = useMemo(() => {
    const made = npcForSearch(query);
    if (!made) return null;
    if (tag && !made.tags.includes(tag)) return null;
    if (npcs.some((npc) => npc.id === made.id)) return null;
    return made;
  }, [query, tag, npcs]);

  function openFromSearch(npc: NpcRecord) {
    if (!listNpcs().some((entry) => entry.id === npc.id)) {
      saveCustomNpc(npc);
      refresh();
    }
    open(npc);
  }

  const selected = selectedId ? listNpcs().find((npc) => npc.id === selectedId) ?? null : null;

  function open(npc: NpcRecord) {
    setSelectedId(npc.id);
    setDraft(null);
    setMessage('');
  }

  function refresh() {
    setRevision((value) => value + 1);
  }

  useEffect(() => {
    if (!selected) return;
    const saved = selected.portrait;
    const prompt = selected.prompt?.trim() ?? '';
    const prose = npcProse(selected);
    if (saved?.picked) return;
    if (saved && portraitMatches(saved, selected.ancestry, selected.role, prose, selected.name) && (!prompt || saved.query === prompt)) return;
    if (saved) {
      clearNpcPortrait(selected.id);
      refresh();
      return;
    }
    let live = true;
    void suggestNpcPortrait(selected.id, selected.ancestry, selected.role, prose, selected.name, prompt).then((portrait) => {
      if (!live || !portrait) return;
      saveNpcPortrait(selected.id, prompt ? { ...portrait, query: prompt } : portrait);
      refresh();
    });
    return () => {
      live = false;
    };
  }, [selected?.id, selected?.portrait?.imageUrl, selected?.portrait?.query, selected?.appearance, selected?.prompt]);

  return (
    <ToolSection id="npcs" title="NPC codex">
      {draft ? (
        <NpcEditor
          npc={draft}
          onCancel={() => setDraft(null)}
          onSave={(npc) => {
            saveCustomNpc(npc);
            setDraft(null);
            setSelectedId(npc.id);
            refresh();
            setMessage('Saved to this browser.');
          }}
        />
      ) : selected ? (
        <NpcDetail
          npc={selected}
          onBack={() => setSelectedId(null)}
          onPortrait={(portrait) => {
            saveNpcPortrait(selected.id, portrait);
            refresh();
          }}
          onEdit={() => setDraft(selected.custom ? { ...selected } : { ...selected, id: `npc-${uuidv4()}`, custom: true })}
          {...(selected.custom ? {
            onDelete: () => {
              deleteCustomNpc(selected.id);
              setSelectedId(null);
              refresh();
            },
          } : {})}
          onSummon={() => {
            const current = listNpcs().find((npc) => npc.id === selected.id) ?? selected;
            const placed = summonNpc(current);
            setMessage(placed ? `${current.name} is on the map.` : 'Open a map before summoning.');
          }}
          message={message}
        />
      ) : (
        <NpcList
          query={query}
          tag={tag}
          npcs={npcs}
          preview={preview}
          onQuery={setQuery}
          onTag={setTag}
          onOpen={open}
          onCreate={openFromSearch}
          onNew={() => {
            setDraft(blankNpc());
            setMessage('');
          }}
        />
      )}
    </ToolSection>
  );
}

function NpcList({
  query,
  tag,
  npcs,
  preview,
  onQuery,
  onTag,
  onOpen,
  onCreate,
  onNew,
}: {
  query: string;
  tag: string;
  npcs: NpcRecord[];
  preview: NpcRecord | null;
  onQuery: (value: string) => void;
  onTag: (value: string) => void;
  onOpen: (npc: NpcRecord) => void;
  onCreate: (npc: NpcRecord) => void;
  onNew: () => void;
}) {
  const searched = query.trim();

  return (
    <>
      <form
        className="space-y-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (preview) onCreate(preview);
        }}
      >
        <input
          className="input-dark w-full text-xs py-1"
          placeholder="gold dragonborn cleric, elf thief..."
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <button type="button" className="btn-ghost w-full px-2 py-1 text-xs" onClick={onNew}>New</button>
      </form>
      <div className="flex flex-wrap gap-1">
        <TagButton label="All" active={tag === ''} onClick={() => onTag('')} />
        {TAGS.map((item) => (
          <TagButton key={item} label={item} active={tag === item} onClick={() => onTag(item)} />
        ))}
      </div>
      <div className="max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
        {preview && (
          <button
            type="button"
            className="w-full text-left rounded px-1.5 py-1 hover:bg-[rgba(201,168,76,0.08)] flex items-center gap-2"
            onClick={() => onCreate(preview)}
          >
            <span
              className="w-8 h-8 rounded shrink-0 overflow-hidden flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              <span className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                {preview.name.slice(0, 1)}
              </span>
            </span>
            <span className="min-w-0">
              <span className="font-ui text-xs block truncate" style={{ color: 'var(--color-text-primary)' }}>
                {preview.name}
              </span>
              <span className="font-ui text-[10px] block truncate" style={{ color: 'var(--color-accent-gold)' }}>
                {preview.ancestry} · {preview.role} · from this search
              </span>
            </span>
          </button>
        )}
        {searched && npcs.length === 0 && !preview && (
          <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Nobody in the codex fits that.
          </p>
        )}
        {npcs.map((npc) => (
          <NpcListRow key={npc.id} npc={npc} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

function NpcListRow({ npc, onOpen }: { npc: NpcRecord; onOpen: (npc: NpcRecord) => void }) {
  const [thumb, setThumb] = useState(npc.portrait?.thumbUrl ?? '');

  useEffect(() => {
    const saved = npc.portrait;
    const prompt = npc.prompt?.trim() ?? '';
    const prose = npcProse(npc);
    if (saved?.picked) {
      setThumb(saved.thumbUrl || saved.imageUrl);
      return;
    }
    if (saved && portraitMatches(saved, npc.ancestry, npc.role, prose, npc.name) && (!prompt || saved.query === prompt)) {
      setThumb(saved.thumbUrl);
      return;
    }
    if (saved) clearNpcPortrait(npc.id);
    setThumb('');
    let live = true;
    void suggestNpcPortrait(npc.id, npc.ancestry, npc.role, prose, npc.name, prompt).then((portrait) => {
      if (!live) return;
      if (!portrait) return;
      const next = prompt ? { ...portrait, query: prompt } : portrait;
      saveNpcPortrait(npc.id, next);
      setThumb(next.thumbUrl);
    });
    return () => {
      live = false;
    };
  }, [npc.id, npc.ancestry, npc.role, npc.appearance, npc.portrait, npc.prompt]);

  return (
    <button
      type="button"
      className="w-full text-left rounded px-1.5 py-1 hover:bg-[rgba(201,168,76,0.08)] flex items-center gap-2"
      onClick={() => onOpen(npc)}
    >
      <span
        className="w-8 h-8 rounded shrink-0 overflow-hidden flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            {(npc.name || '?').slice(0, 1)}
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="font-ui text-xs block truncate" style={{ color: 'var(--color-text-primary)' }}>
          {npc.name || 'Unnamed'}
          {npc.custom ? <span style={{ color: '#60a5fa' }}> · yours</span> : null}
        </span>
        <span className="font-ui text-[10px] block truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {npc.ancestry} {npc.role}
        </span>
      </span>
    </button>
  );
}

function NpcDetail({
  npc,
  message,
  onBack,
  onPortrait,
  onEdit,
  onDelete,
  onSummon,
}: {
  npc: NpcRecord;
  message: string;
  onBack: () => void;
  onPortrait: (portrait: NpcPortrait) => void;
  onEdit: () => void;
  onDelete?: () => void;
  onSummon: () => void;
}) {
  const [portraitQuery, setPortraitQuery] = useState(portraitSearchText(npc.ancestry, npc.role, npcProse(npc), npc.name, npc.prompt ?? ''));
  useEffect(() => {
    setPortraitQuery(portraitSearchText(npc.ancestry, npc.role, npcProse(npc), npc.name, npc.prompt ?? ''));
  }, [npc.id, npc.prompt, npc.ancestry, npc.role, npc.appearance, npc.name]);
  const [portraits, setPortraits] = useState<NpcPortrait[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function findPortraits() {
    const term = portraitQuery.trim();
    if (!term) return;
    setLoading(true);
    setError('');
    try {
      const found = await searchNpcPortraits(term, 1);
      setPortraits(found.portraits);
      if (found.portraits.length === 0) setError('No D&D character pictures for that search.');
    } catch {
      setError('Could not reach the picture libraries.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="font-ui text-[10px] opacity-70 hover:opacity-100" onClick={onBack}>
        ← Codex
      </button>
      <div className="space-y-1">
        <div className="flex gap-2 items-start">
          <div
            className="w-16 h-16 shrink-0 rounded overflow-hidden flex items-center justify-center"
            style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}
          >
            {npc.portrait ? (
              <img src={npc.portrait.thumbUrl || npc.portrait.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-display text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {(npc.name || '?').slice(0, 1)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-display text-sm" style={{ color: 'var(--color-accent-gold)' }}>{npc.name}</p>
            <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
              {npc.ancestry} · {npc.role}
            </p>
            <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
              AC {npc.ac} · HP {npc.hp}
            </p>
          </div>
        </div>
        {npc.portrait && (
          <a
            className="font-ui text-[10px] underline leading-snug break-words"
            style={{ color: 'var(--color-text-secondary)' }}
            href={npc.portrait.pageUrl}
            target="_blank"
            rel="noreferrer"
          >
            {npc.portrait.creator} · {npc.portrait.license} · {npc.portrait.source}
          </a>
        )}
      </div>
      <Field label="Appearance" text={npc.appearance} />
      <Field label="Personality" text={npc.personality} />
      <Field label="Voice" text={npc.voice} />
      <Field label="Hook" text={npc.hook} />
      <Field label="Secret" text={npc.secret} />
      {npc.attack && <Field label="If it comes to blows" text={npc.attack} />}
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void findPortraits();
        }}
      >
        <input
          className="input-dark flex-1 text-xs py-1"
          value={portraitQuery}
          onChange={(event) => setPortraitQuery(event.target.value)}
          placeholder="half-elf child, goblin in a red cloak..."
        />
        <button className="btn-primary px-2 py-1 text-xs" type="submit" disabled={loading || !portraitQuery.trim()}>
          {loading ? '...' : 'Art'}
        </button>
      </form>
      {error && <p className="font-ui text-[10px]" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>}
      {portraits.length > 0 && (
        <div className="grid grid-cols-3 gap-1 max-h-40 overflow-y-auto">
          {portraits.map((portrait) => (
            <button
              key={portrait.id}
              type="button"
              className="text-left"
              title={`${portrait.title} — ${portrait.creator} (${portrait.license})`}
              onClick={() => {
                const chosen = portrait.thumbUrl.startsWith('https://') ? portrait.thumbUrl : portrait.imageUrl;
                onPortrait({
                  ...portrait,
                  imageUrl: chosen,
                  thumbUrl: chosen,
                  picked: true,
                  ...(portraitQuery.trim() ? { query: portraitQuery.trim() } : {}),
                });
              }}
            >
              <img src={portrait.thumbUrl} alt={portrait.title} className="w-full h-16 object-cover rounded" />
              <span className="font-ui text-[9px] block truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {portrait.license}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        Pictures are D&amp;D character portraits. Sprite sheets, cartoons, photographs of real people, and generated art are left out. Each picture keeps its creator and source.
      </p>
      <div className="flex gap-1">
        <button type="button" className="btn-primary flex-1 text-xs py-1" onClick={onSummon}>Summon</button>
        <button type="button" className="btn-ghost text-xs py-1 px-2" onClick={onEdit}>{onDelete ? 'Edit' : 'Copy'}</button>
        {onDelete && (
          <button type="button" className="btn-ghost text-xs py-1 px-2" style={{ color: 'var(--color-accent-red-hot)' }} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      {message && <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>}
    </div>
  );
}

function NpcEditor({
  npc,
  onCancel,
  onSave,
}: {
  npc: NpcEntry;
  onCancel: () => void;
  onSave: (npc: NpcEntry) => void;
}) {
  const [draft, setDraft] = useState(npc);
  function set<K extends keyof NpcEntry>(key: K, value: NpcEntry[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <div className="space-y-1">
      <button type="button" className="font-ui text-[10px] opacity-70 hover:opacity-100" onClick={onCancel}>← Back</button>
      <input className="input-dark w-full text-xs py-1" placeholder="Name" value={draft.name} onChange={(event) => set('name', event.target.value)} />
      <div className="flex gap-1">
        <input className="input-dark flex-1 text-xs py-1" placeholder="Role" value={draft.role} onChange={(event) => set('role', event.target.value)} />
        <input className="input-dark flex-1 text-xs py-1" placeholder="Ancestry" value={draft.ancestry} onChange={(event) => set('ancestry', event.target.value)} />
      </div>
      <textarea className="input-dark w-full text-xs h-14" placeholder="Appearance" value={draft.appearance} onChange={(event) => set('appearance', event.target.value)} />
      <textarea className="input-dark w-full text-xs h-14" placeholder="Personality" value={draft.personality} onChange={(event) => set('personality', event.target.value)} />
      <input className="input-dark w-full text-xs py-1" placeholder="Voice" value={draft.voice} onChange={(event) => set('voice', event.target.value)} />
      <textarea className="input-dark w-full text-xs h-14" placeholder="Hook" value={draft.hook} onChange={(event) => set('hook', event.target.value)} />
      <textarea className="input-dark w-full text-xs h-14" placeholder="Secret" value={draft.secret} onChange={(event) => set('secret', event.target.value)} />
      <div className="flex gap-1">
        <label className="font-ui text-[10px] flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
          AC
          <input className="input-dark w-12 text-xs py-1" type="number" value={draft.ac} onChange={(event) => set('ac', Number(event.target.value) || 10)} />
        </label>
        <label className="font-ui text-[10px] flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
          HP
          <input className="input-dark w-12 text-xs py-1" type="number" value={draft.hp} onChange={(event) => set('hp', Number(event.target.value) || 1)} />
        </label>
      </div>
      <button
        type="button"
        className="btn-primary w-full text-xs py-1.5"
        disabled={!draft.name.trim()}
        onClick={() => onSave({ ...draft, name: draft.name.trim(), custom: true })}
      >
        Save NPC
      </button>
    </div>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <p className="font-ui text-[11px] leading-snug" style={{ color: 'var(--color-text-primary)' }}>
      <span style={{ color: 'var(--color-accent-gold)' }}>{label}. </span>
      {text}
    </p>
  );
}

function TagButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded px-1.5 py-0.5 font-ui text-[10px] border"
      style={{
        color: active ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
        borderColor: active ? 'var(--color-accent-gold)' : 'var(--color-border)',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
