import { useMemo, useState } from 'react';
import { ToolSection } from '@/systems/map/ToolSection';
import { ModularKitPreview } from './ModularKitPreview';
import {
  CATALOG_SECTIONS,
  KAYKIT_PIECES,
  KENNEY_PIECES,
  type ModularPiece,
} from './modularKits';

export function ModularKitPanel({
  onPlace,
}: {
  onPlace: (piece: ModularPiece) => void;
}) {
  const [kit, setKit] = useState<'kenney' | 'kaykit'>('kenney');
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<'all' | ModularPiece['kind']>('all');
  const all = kit === 'kenney' ? KENNEY_PIECES : KAYKIT_PIECES;
  const [previewKey, setPreviewKey] = useState(all[0]?.key ?? 'corridor');

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return all.filter((p) => {
      if (section !== 'all' && p.kind !== section) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q)
        || p.key.toLowerCase().includes(q)
        || p.kind.includes(q)
      );
    });
  }, [all, q, section]);

  const preview = filtered.find((p) => p.key === previewKey)
    ?? all.find((p) => p.key === previewKey)
    ?? filtered[0]
    ?? all[0]!;

  const sections = CATALOG_SECTIONS.filter((s) => all.some((p) => p.kind === s.kind));

  function switchKit(next: 'kenney' | 'kaykit') {
    const pieces = next === 'kenney' ? KENNEY_PIECES : KAYKIT_PIECES;
    setKit(next);
    setQuery('');
    setSection('all');
    setPreviewKey(pieces[0]!.key);
  }

  return (
    <ToolSection id="modular-kits" title="3D dungeon catalog">
      <div className="flex gap-1">
        <button
          type="button"
          className={`flex-1 text-xs py-1 rounded font-ui ${
            kit === 'kenney'
              ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c44]'
              : 'text-[#8a8075] border border-[#2a2a3a]'
          }`}
          onClick={() => switchKit('kenney')}
        >
          Kenney · {KENNEY_PIECES.length}
        </button>
        <button
          type="button"
          className={`flex-1 text-xs py-1 rounded font-ui ${
            kit === 'kaykit'
              ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c44]'
              : 'text-[#8a8075] border border-[#2a2a3a]'
          }`}
          onClick={() => switchKit('kaykit')}
        >
          KayKit · {KAYKIT_PIECES.length}
        </button>
      </div>
      <ModularKitPreview piece={preview} />
      <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        Full packs: {KENNEY_PIECES.length} Kenney + {KAYKIT_PIECES.length} KayKit. 1 m = 1 cell.
        Hover to preview, click to drop.
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search catalog…"
        className="w-full rounded border border-[#2a2a3a] bg-[#12121a] px-1.5 py-1 font-ui text-[11px] text-[#e8e0d0] outline-none focus:border-[#c9a84c88]"
      />
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 font-ui text-[10px] ${
            section === 'all'
              ? 'bg-[#c9a84c22] text-[#c9a84c]'
              : 'text-[#8a8075] border border-[#2a2a3a]'
          }`}
          onClick={() => setSection('all')}
        >
          All · {all.length}
        </button>
        {sections.map((s) => {
          const n = all.filter((p) => p.kind === s.kind).length;
          return (
            <button
              key={s.kind}
              type="button"
              className={`rounded px-1.5 py-0.5 font-ui text-[10px] ${
                section === s.kind
                  ? 'bg-[#c9a84c22] text-[#c9a84c]'
                  : 'text-[#8a8075] border border-[#2a2a3a]'
              }`}
              onClick={() => setSection(s.kind)}
            >
              {s.label} · {n}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-1 max-h-96 overflow-y-auto pr-0.5">
        {filtered.map((p) => (
          <button
            key={p.url}
            type="button"
            className={`text-left rounded px-1.5 py-1 border ${
              p.key === preview.key
                ? 'border-[#c9a84c88] bg-[#c9a84c14]'
                : 'border-[#2a2a3a] hover:border-[#c9a84c66]'
            }`}
            onMouseEnter={() => setPreviewKey(p.key)}
            onFocus={() => setPreviewKey(p.key)}
            onClick={() => onPlace(p)}
            title={p.title}
          >
            <div className="font-ui text-[11px] text-[#e8e0d0] truncate">{p.title}</div>
            <div className="font-ui text-[9px] text-[#8a8075]">
              {p.w}×{p.h}m{p.anim?.clips ? ' · anim' : p.anim?.doorNode ? ' · swing' : ''}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 font-ui text-[11px] text-[#8a8075] py-2">No pieces match.</div>
        )}
      </div>
    </ToolSection>
  );
}
