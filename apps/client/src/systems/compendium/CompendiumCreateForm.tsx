import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompendiumTab } from './compendiumStore';
import { useCompendiumUiStore } from './compendiumStore';
import { createItem, createMonster, createSpell, fetchSources, saveEntryImages } from './compendiumApi';
import { fileToDataUrl } from '@/lib/imagePersistence';

type SourceKind = 'homebrew' | 'book';
const NEW_BOOK = '__new__';

function browseBtnStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'rgba(201,168,76,0.2)' : 'transparent',
    color: active ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
    border: `1px solid ${active ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
  };
}

export function CompendiumCreateForm({ tab }: { tab: CompendiumTab }) {
  const qc = useQueryClient();
  const browseMode = useCompendiumUiStore((s) => s.browseMode);
  const selectedSource = useCompendiumUiStore((s) => s.selectedSource);
  const setCreating = useCompendiumUiStore((s) => s.setCreating);
  const setBrowseMode = useCompendiumUiStore((s) => s.setBrowseMode);
  const setSelectedSource = useCompendiumUiStore((s) => s.setSelectedSource);
  const selectMonster = useCompendiumUiStore((s) => s.selectMonster);
  const selectItem = useCompendiumUiStore((s) => s.selectItem);
  const selectSpell = useCompendiumUiStore((s) => s.selectSpell);

  const defaultSourceKind: SourceKind =
    browseMode === 'sources' && selectedSource ? 'book' : 'homebrew';

  const [sourceKind, setSourceKind] = useState<SourceKind>(defaultSourceKind);
  const [bookPick, setBookPick] = useState(
    browseMode === 'sources' && selectedSource ? selectedSource : '',
  );
  const [newBookName, setNewBookName] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState(tab === 'monsters' ? 'Medium humanoid, neutral' : '');
  const [hp, setHp] = useState(10);
  const [ac, setAc] = useState(10);
  const [cr, setCr] = useState('0');
  const [level, setLevel] = useState(0);
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);

  const sourcesQ = useQuery({
    queryKey: ['compendium', 'sources', tab, 'create'],
    queryFn: () => fetchSources(tab),
    staleTime: 60_000,
  });

  const bookOptions = useMemo(() => sourcesQ.data ?? [], [sourcesQ.data]);

  function resolveSource(): string | null {
    if (sourceKind === 'homebrew') return 'Custom';
    if (bookPick === NEW_BOOK) {
      const trimmed = newBookName.trim();
      return trimmed || null;
    }
    return bookPick.trim() || null;
  }

  const sourceReady = sourceKind === 'homebrew' || Boolean(resolveSource());

  const createMut = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name required');
      const source = resolveSource();
      if (!source) throw new Error('Select or enter a source book');

      let entry;
      if (tab === 'monsters') {
        entry = await createMonster({
          name: trimmed,
          type: type.trim() || 'Medium humanoid, neutral',
          source,
          hp,
          ac,
          cr,
          description,
        });
        const img = imagePreview ?? (imageUrl.trim() || null);
        if (img) await saveEntryImages('monster', entry.id, img);
      } else if (tab === 'items') {
        entry = await createItem({
          name: trimmed,
          type: type.trim(),
          source,
          description,
        });
      } else {
        entry = await createSpell({
          name: trimmed,
          level,
          source,
          description,
        });
      }
      return { entry, source, sourceKind };
    },
    onSuccess: ({ entry, source, sourceKind: kind }) => {
      void qc.invalidateQueries({ queryKey: ['compendium'] });
      setCreating(false);
      if (kind === 'book') {
        setBrowseMode('sources');
        setSelectedSource(source);
      } else {
        setBrowseMode('homebrew');
        setSelectedSource(null);
      }
      if (tab === 'monsters') selectMonster(entry.id);
      else if (tab === 'items') selectItem(entry.id);
      else selectSpell(entry.id);
    },
  });

  const label = tab === 'monsters' ? 'monster' : tab === 'items' ? 'item' : 'spell';

  return (
    <div className="space-y-2">
      <h3 className="font-display text-sm tracking-wide" style={{ color: 'var(--color-accent-gold)' }}>
        New {label}
      </h3>

      <div>
        <p className="font-ui text-[10px] mb-1" style={{ color: 'var(--color-text-secondary)' }}>
          Add to
        </p>
        <div className="flex gap-0.5">
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded flex-1 capitalize"
            style={browseBtnStyle(sourceKind === 'homebrew')}
            onClick={() => setSourceKind('homebrew')}
          >
            Homebrew
          </button>
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded flex-1"
            style={browseBtnStyle(sourceKind === 'book')}
            onClick={() => {
              setSourceKind('book');
              if (!bookPick && bookOptions.length > 0) {
                setBookPick(bookOptions[0]!.id);
              }
            }}
          >
            Source book
          </button>
        </div>
      </div>

      {sourceKind === 'book' && (
        <div className="space-y-1">
          <select
            className="input-dark text-xs w-full py-0.5"
            value={bookPick}
            onChange={(e) => setBookPick(e.target.value)}
          >
            {bookOptions.length === 0 && bookPick !== NEW_BOOK && (
              <option value="">No books yet — create one below</option>
            )}
            {bookOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
            <option value={NEW_BOOK}>+ New source book…</option>
          </select>
          {bookPick === NEW_BOOK && (
            <input
              className="input-dark text-xs w-full py-0.5"
              placeholder="Book name (e.g. Dungeon Master's Guide)"
              value={newBookName}
              onChange={(e) => setNewBookName(e.target.value)}
            />
          )}
        </div>
      )}

      <input
        className="input-dark text-xs w-full py-0.5"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {tab === 'monsters' && (
        <>
          <input
            className="input-dark text-xs w-full py-0.5"
            placeholder="Type (e.g. Medium beast, unaligned)"
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
          <label className="font-ui text-xs flex gap-2 items-center" style={{ color: 'var(--color-text-secondary)' }}>
            HP <input type="number" className="input-stat" value={hp} onChange={(e) => setHp(Number(e.target.value))} />
            AC <input type="number" className="input-stat" value={ac} onChange={(e) => setAc(Number(e.target.value))} />
            CR <input className="input-dark text-xs py-0.5 w-12" value={cr} onChange={(e) => setCr(e.target.value)} />
          </label>
          <div className="space-y-1">
            <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Image (optional)</p>
            {imagePreview && (
              <img src={imagePreview} alt="" className="max-h-20 rounded object-contain" />
            )}
            <input
              className="input-dark text-xs w-full py-0.5"
              placeholder="Image URL"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setImagePreview(e.target.value.trim() || null);
              }}
            />
            <input
              ref={imageFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await fileToDataUrl(file);
                setImagePreview(dataUrl);
                setImageUrl('');
              }}
            />
            <button
              type="button"
              className="btn-ghost text-xs py-0.5 px-1"
              onClick={() => imageFileRef.current?.click()}
            >
              Upload image
            </button>
          </div>
        </>
      )}
      {tab === 'items' && (
        <input
          className="input-dark text-xs w-full py-0.5"
          placeholder="Type (e.g. Wondrous item)"
          value={type}
          onChange={(e) => setType(e.target.value)}
        />
      )}
      {tab === 'spells' && (
        <label className="font-ui text-xs flex gap-2 items-center" style={{ color: 'var(--color-text-secondary)' }}>
          Level
          <input type="number" className="input-stat" value={level} min={0} max={9} onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
      )}
      <textarea
        className="input-dark text-xs w-full h-24"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {createMut.isError && (
        <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>
          Failed to create. Check MongoDB connection.
        </p>
      )}
      <div className="flex gap-1">
        <button
          className="btn-primary text-xs px-2 py-0.5 flex-1"
          disabled={!name.trim() || !sourceReady || createMut.isPending}
          onClick={() => createMut.mutate()}
        >
          {createMut.isPending ? 'Saving…' : 'Create & sync'}
        </button>
        <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setCreating(false)}>Cancel</button>
      </div>
    </div>
  );
}
