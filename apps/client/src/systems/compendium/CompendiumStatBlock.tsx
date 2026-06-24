import { useEffect, useState } from 'react';
import axios from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CompendiumItem, CompendiumMonster, CompendiumSpell, CompendiumSaveAs } from '@grimoire/shared';
import { isFromSourceBook, isHomebrewEntry } from '@grimoire/shared';
import { RollableText } from '@/systems/dice/RollableText';
import { saveItem, saveMonster, saveSpell, deleteItem, deleteMonster, deleteSpell, publishCompendiumEntry, unpublishCompendiumEntry } from './compendiumApi';
import { useCompendiumUiStore } from './compendiumStore';
import { CompendiumImageEditor } from './CompendiumImageEditor';
import { MonsterRollPanel } from './MonsterRollPanel';
import { SpellRollPanel } from './SpellRollPanel';

function saveErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const msg = err.response?.data?.error;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return 'Save failed. Check your connection and try again.';
}

function onSaveSuccess(
  qc: ReturnType<typeof useQueryClient>,
  tab: 'monsters' | 'items' | 'spells',
  previousId: string,
  saved: { id: string },
  setEditing: (v: boolean) => void,
) {
  void qc.invalidateQueries({ queryKey: ['compendium'] });
  if (saved.id !== previousId) {
    const store = useCompendiumUiStore.getState();
    if (tab === 'monsters') store.selectMonster(saved.id);
    else if (tab === 'items') store.selectItem(saved.id);
    else store.selectSpell(saved.id);
  }
  setEditing(false);
}

function useDeleteEntry(kind: 'monsters' | 'items' | 'spells', id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (kind === 'monsters') await deleteMonster(id);
      else if (kind === 'items') await deleteItem(id);
      else await deleteSpell(id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['compendium'] });
      const store = useCompendiumUiStore.getState();
      if (kind === 'monsters') store.selectMonster(null);
      else if (kind === 'items') store.selectItem(null);
      else store.selectSpell(null);
    },
  });
}

function EditSaveMode({
  value,
  onChange,
  source,
}: {
  value: CompendiumSaveAs;
  onChange: (v: CompendiumSaveAs) => void;
  source?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
        Save as
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          className="btn-ghost text-xs px-2 py-0.5 flex-1"
          style={value === 'replace' ? { borderColor: 'var(--color-accent-gold)', color: 'var(--color-accent-gold)' } : undefined}
          onClick={() => onChange('replace')}
        >
          Replace in source book
        </button>
        <button
          type="button"
          className="btn-ghost text-xs px-2 py-0.5 flex-1"
          style={value === 'homebrew' ? { borderColor: 'var(--color-accent-gold)', color: 'var(--color-accent-gold)' } : undefined}
          onClick={() => onChange('homebrew')}
        >
          Save as homebrew
        </button>
      </div>
      {value === 'replace' && source && (
        <p className="font-ui text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
          Stays under: {source}
        </p>
      )}
    </div>
  );
}

function DeleteButton({
  kind,
  id,
  name,
}: {
  kind: 'monsters' | 'items' | 'spells';
  id: string;
  name: string;
}) {
  const deleteMut = useDeleteEntry(kind, id);
  return (
    <button
      type="button"
      className="btn-ghost text-xs px-2 py-1"
      style={{ color: 'var(--color-accent-red-hot)' }}
      disabled={deleteMut.isPending}
      onClick={() => {
        if (!window.confirm(`Remove "${name}" from the compendium?`)) return;
        deleteMut.mutate();
      }}
    >
      {deleteMut.isPending ? '…' : 'Delete'}
    </button>
  );
}

function PublishToDexButton({
  kind,
  name,
  isDraft,
}: {
  kind: 'monster' | 'item' | 'spell';
  name: string;
  isDraft?: boolean;
}) {
  const qc = useQueryClient();
  const publishMut = useMutation({
    mutationFn: () => publishCompendiumEntry(kind, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['compendium'] }),
  });
  const unpublishMut = useMutation({
    mutationFn: () => unpublishCompendiumEntry(kind, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['compendium'] }),
  });

  if (isDraft) {
    return (
      <button
        type="button"
        className="btn-primary text-xs px-2 py-1 flex-1"
        disabled={publishMut.isPending}
        onClick={() => publishMut.mutate()}
      >
        {publishMut.isPending ? 'Publishing…' : 'Publish to Dex'}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-ghost text-xs px-2 py-1"
      disabled={unpublishMut.isPending}
      onClick={() => {
        if (!window.confirm(`Hide "${name}" from players again?`)) return;
        unpublishMut.mutate();
      }}
    >
      {unpublishMut.isPending ? '…' : 'Unpublish'}
    </button>
  );
}

export function MonsterStatBlock({
  monster,
  editable = false,
  onSummon,
}: {
  monster: CompendiumMonster;
  editable?: boolean;
  onSummon?: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(monster.name);
  const [type, setType] = useState(monster.type);
  const [hp, setHp] = useState(monster.hp);
  const [ac, setAc] = useState(monster.ac);
  const [cr, setCr] = useState(monster.cr);
  const [desc, setDesc] = useState(monster.description);
  const [saveAs, setSaveAs] = useState<CompendiumSaveAs>('replace');
  const fromBook = isFromSourceBook(monster.isCustom, monster.source);

  useEffect(() => {
    setName(monster.name);
    setType(monster.type);
    setHp(monster.hp);
    setAc(monster.ac);
    setCr(monster.cr);
    setDesc(monster.description);
    setSaveAs(fromBook ? 'replace' : 'homebrew');
  }, [monster.id, monster.name, monster.type, monster.hp, monster.ac, monster.cr, monster.description, fromBook]);

  const saveMut = useMutation({
    mutationFn: () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name required');
      return saveMonster(monster.id, {
        name: trimmed,
        type,
        hp,
        ac,
        cr,
        description: desc,
        source: monster.source,
        saveAs: fromBook ? saveAs : 'homebrew',
      });
    },
    onSuccess: (saved) => onSaveSuccess(qc, 'monsters', monster.id, saved, setEditing),
    onError: (err) => {
      console.error('[Compendium] Save monster error:', err);
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm tracking-wide" style={{ color: 'var(--color-accent-gold)' }}>
            {monster.name}
            {monster.isDraft && (
              <span className="font-ui ml-1 text-[10px] normal-case" style={{ color: '#fbbf24' }}>draft</span>
            )}
          </h3>
          <p className="font-ui text-xs italic" style={{ color: 'var(--color-text-secondary)' }}>{monster.type}</p>
        </div>
        <span className="font-ui text-xs shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
          CR {monster.cr}
        </span>
      </div>
      <CompendiumImageEditor
        kind="monster"
        entryId={monster.id}
        entryName={monster.name}
        {...(monster.imageUrl ? { fallbackUrl: monster.imageUrl } : {})}
      />
      <div className="gold-divider" />
      {editing ? (
        <div className="space-y-1.5">
          <input className="input-dark text-xs w-full py-0.5" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input-dark text-xs w-full py-0.5" placeholder="Type" value={type} onChange={(e) => setType(e.target.value)} />
          <label className="font-ui text-xs flex gap-2 items-center" style={{ color: 'var(--color-text-secondary)' }}>
            HP <input type="number" className="input-stat" value={hp} onChange={(e) => setHp(Number(e.target.value))} />
            AC <input type="number" className="input-stat" value={ac} onChange={(e) => setAc(Number(e.target.value))} />
            CR <input className="input-dark text-xs py-0.5 w-12" value={cr} onChange={(e) => setCr(e.target.value)} />
          </label>
          <textarea className="input-dark text-xs w-full h-32" value={desc} onChange={(e) => setDesc(e.target.value)} />
          {fromBook && (
            <EditSaveMode value={saveAs} onChange={setSaveAs} source={monster.source} />
          )}
          {saveMut.isError && (
            <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>
              {saveErrorMessage(saveMut.error)}
            </p>
          )}
          <div className="flex gap-1">
            <button className="btn-primary text-xs px-2 py-0.5" disabled={saveMut.isPending || !name.trim()} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="font-ui text-xs" style={{ color: 'var(--color-text-primary)' }}>
            AC {monster.ac} · HP {monster.hp} · {monster.source}
            {isHomebrewEntry(monster.isCustom, monster.source) && (
              <span style={{ color: '#60a5fa' }}> · homebrew</span>
            )}
          </p>
          <MonsterRollPanel monster={monster} />
          <div className="flex flex-wrap gap-1 pt-1">
            {editable && monster.isDraft && (
              <PublishToDexButton kind="monster" name={monster.name} isDraft={monster.isDraft} />
            )}
            {onSummon && (
              <button className="btn-primary text-xs px-2 py-1 flex-1" onClick={onSummon}>Summon</button>
            )}
            {editable && (
              <>
                {!monster.isDraft && (
                  <PublishToDexButton kind="monster" name={monster.name} isDraft={false} />
                )}
                <button className="btn-ghost text-xs px-2 py-1" onClick={() => setEditing(true)}>Edit</button>
                <DeleteButton kind="monsters" id={monster.id} name={monster.name} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function ItemStatBlock({
  item,
  editable = false,
  onPlaceHandout,
}: {
  item: CompendiumItem;
  editable?: boolean;
  onPlaceHandout?: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [itemType, setItemType] = useState(item.type);
  const [desc, setDesc] = useState(item.description);
  const [saveAs, setSaveAs] = useState<CompendiumSaveAs>('replace');
  const fromBook = isFromSourceBook(item.isCustom, item.source);

  useEffect(() => {
    setName(item.name);
    setItemType(item.type);
    setDesc(item.description);
    setSaveAs(fromBook ? 'replace' : 'homebrew');
  }, [item.id, item.name, item.type, item.description, fromBook]);

  const saveMut = useMutation({
    mutationFn: () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name required');
      return saveItem(item.id, {
        name: trimmed,
        type: itemType,
        description: desc,
        source: item.source,
        saveAs: fromBook ? saveAs : 'homebrew',
      });
    },
    onSuccess: (saved) => onSaveSuccess(qc, 'items', item.id, saved, setEditing),
  });

  return (
    <div className="space-y-2">
      <h3 className="font-display text-sm" style={{ color: 'var(--color-accent-gold)' }}>
        {item.name}
        {item.isDraft && (
          <span className="font-ui ml-1 text-[10px] normal-case" style={{ color: '#fbbf24' }}>draft</span>
        )}
      </h3>
      <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {item.type}{item.rarity ? ` · ${item.rarity}` : ''} · {item.source}
        {isHomebrewEntry(item.isCustom, item.source) && (
          <span style={{ color: '#60a5fa' }}> · homebrew</span>
        )}
      </p>
      <CompendiumImageEditor
        kind="item"
        entryId={item.id}
        entryName={item.name}
        {...(item.imageUrl ? { fallbackUrl: item.imageUrl } : {})}
      />
      <div className="gold-divider" />
      {editing ? (
        <>
          <input className="input-dark text-xs w-full py-0.5" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input-dark text-xs w-full py-0.5" placeholder="Type (e.g. Wondrous item)" value={itemType} onChange={(e) => setItemType(e.target.value)} />
          <textarea className="input-dark text-xs w-full h-32" value={desc} onChange={(e) => setDesc(e.target.value)} />
          {fromBook && (
            <EditSaveMode value={saveAs} onChange={setSaveAs} source={item.source} />
          )}
          {saveMut.isError && (
            <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>
              {saveErrorMessage(saveMut.error)}
            </p>
          )}
          <div className="flex gap-1">
            <button className="btn-primary text-xs px-2 py-0.5" disabled={saveMut.isPending || !name.trim()} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <RollableText text={item.description || item.flavor || ''} className="max-h-64 overflow-y-auto" />
          <div className="flex flex-wrap gap-1 pt-1">
            {editable && item.isDraft && (
              <PublishToDexButton kind="item" name={item.name} isDraft={item.isDraft} />
            )}
            {onPlaceHandout && (
              <button className="btn-primary text-xs px-2 py-1 flex-1" onClick={onPlaceHandout}>
                Place on map
              </button>
            )}
            {editable && (
              <>
                {!item.isDraft && (
                  <PublishToDexButton kind="item" name={item.name} isDraft={false} />
                )}
                <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setEditing(true)}>Edit</button>
                <DeleteButton kind="items" id={item.id} name={item.name} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function SpellStatBlock({ spell, editable = false }: { spell: CompendiumSpell; editable?: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState(spell.name);
  const [level, setLevel] = useState(spell.level);
  const [editing, setEditing] = useState(false);
  const [saveAs, setSaveAs] = useState<CompendiumSaveAs>('replace');
  const fromBook = isFromSourceBook(spell.isCustom, spell.source);

  useEffect(() => {
    setName(spell.name);
    setLevel(spell.level);
    setSaveAs(fromBook ? 'replace' : 'homebrew');
  }, [spell.id, spell.name, spell.level, fromBook]);

  const saveMut = useMutation({
    mutationFn: () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name required');
      return saveSpell(spell.id, {
        name: trimmed,
        level,
        ...(spell.source ? { source: spell.source } : {}),
        saveAs: fromBook ? saveAs : 'homebrew',
      });
    },
    onSuccess: (saved) => onSaveSuccess(qc, 'spells', spell.id, saved, setEditing),
  });

  return (
    <div className="space-y-2">
      <h3 className="font-display text-sm" style={{ color: 'var(--color-accent-gold)' }}>
        {spell.name}
        {spell.isDraft && (
          <span className="font-ui ml-1 text-[10px] normal-case" style={{ color: '#fbbf24' }}>draft</span>
        )}
      </h3>
      <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Level {spell.level}
        {spell.damage ? ` · ${spell.damage} ${spell.type ?? ''}` : ''}
        {spell.aoe ? ` · ${spell.aoe.size}ft ${spell.aoe.type}` : ''}
      </p>
      <CompendiumImageEditor
        kind="spell"
        entryId={spell.id}
        entryName={spell.name}
        {...(spell.imageUrl ? { fallbackUrl: spell.imageUrl } : {})}
      />
      <div className="gold-divider" />
      <SpellRollPanel spell={spell} />
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <input className="input-dark text-xs w-full py-0.5" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="font-ui text-xs flex gap-2 items-center" style={{ color: 'var(--color-text-secondary)' }}>
            Level
            <input type="number" className="input-stat" value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          </label>
          {fromBook && spell.source && (
            <EditSaveMode value={saveAs} onChange={setSaveAs} source={spell.source} />
          )}
          {saveMut.isError && (
            <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>
              {saveErrorMessage(saveMut.error)}
            </p>
          )}
          <div className="flex gap-1">
            <button className="btn-primary text-xs px-2 py-0.5" disabled={saveMut.isPending || !name.trim()} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : editable && (
        <div className="flex flex-wrap gap-1">
          {spell.isDraft && (
            <PublishToDexButton kind="spell" name={spell.name} isDraft={spell.isDraft} />
          )}
          {!spell.isDraft && (
            <PublishToDexButton kind="spell" name={spell.name} isDraft={false} />
          )}
          <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setEditing(true)}>Edit</button>
          <DeleteButton kind="spells" id={spell.id} name={spell.name} />
        </div>
      )}
    </div>
  );
}
