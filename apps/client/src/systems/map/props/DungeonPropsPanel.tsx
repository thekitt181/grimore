import { useMemo, useState } from 'react';
import { listDungeonProps, placeDungeonProp, type DungeonProp } from './dungeonProps';
import { ALSTRA_CREDIT, ALSTRA_PROP_ART } from './alstraPropCatalog';
import { KAYKIT_PROP_ART } from './kaykitPropCatalog';
import { SAZKUASH_CREDIT, SAZKUASH_PROP_ART } from './sazkuashPropCatalog';
import { ASSETS2D_CHEST_ART, ASSETS2D_CREDIT } from './assets2dChestCatalog';
import { SPAJX_CREDIT, SPAJX_PROP_ART } from './spajxPropCatalog';
import { ToolSection } from '@/systems/map/ToolSection';
import { PropCatalogPreview } from './PropCatalogPreview';

const KAYKIT_IDS = new Set(KAYKIT_PROP_ART.map((p) => p.id));
const ALSTRA_IDS = new Set(ALSTRA_PROP_ART.map((p) => p.id));
const A2D_IDS = new Set(ASSETS2D_CHEST_ART.map((p) => p.id));
const SPAJX_IDS = new Set(SPAJX_PROP_ART.map((p) => p.id));
const SAZKUASH_IDS = new Set(SAZKUASH_PROP_ART.map((p) => p.id));
type PropPack = 'core' | 'kaykit' | 'alstra' | 'sazkuash';

const KAYKIT_GROUPS: Array<{ id: string; label: string; test: (id: string) => boolean }> = [
  { id: 'chest', label: 'Chests', test: (id) => /^(chest|trunk)/.test(id) },
  { id: 'banner', label: 'Banners', test: (id) => id.startsWith('banner') },
  { id: 'container', label: 'Boxes', test: (id) => /^(barrel|keg|box|crate)/.test(id) },
  { id: 'table', label: 'Tables', test: (id) => /^(table|chair|stool|bed|shelf)/.test(id) },
  { id: 'light', label: 'Lights', test: (id) => /^(torch|candle)/.test(id) },
  { id: 'decor', label: 'Decor', test: (id) => /^(bottle|coin|key|plate|sword|barrier|pillar|column|rubble)/.test(id) },
];

function packOf(id: string): PropPack {
  if (ALSTRA_IDS.has(id) || A2D_IDS.has(id) || SPAJX_IDS.has(id)) return 'alstra';
  if (SAZKUASH_IDS.has(id)) return 'sazkuash';
  if (KAYKIT_IDS.has(id)) return 'kaykit';
  return 'core';
}

/** Unique label so KayKit variants are not all “Banner” / “Trunk”. */
function tileLabel(prop: DungeonProp): string {
  if (packOf(prop.id) === 'core' || packOf(prop.id) === 'sazkuash' || A2D_IDS.has(prop.id) || SPAJX_IDS.has(prop.id)) return prop.short;
  const bits = prop.name.replace(/^(Banner |Table |Trunk |Bottle |Candle |Barrier )/, '');
  return bits.length <= 16 ? bits : bits.slice(0, 15);
}

export function DungeonPropsPanel() {
  const [hidden, setHidden] = useState(false);
  const [query, setQuery] = useState('');
  const [pack, setPack] = useState<PropPack>('core');
  const [group, setGroup] = useState('all');
  const props = useMemo(() => listDungeonProps(), []);
  const core = useMemo(() => props.filter((p) => packOf(p.id) === 'core'), [props]);
  const kaykit = useMemo(() => props.filter((p) => packOf(p.id) === 'kaykit'), [props]);
  const alstra = useMemo(() => props.filter((p) => packOf(p.id) === 'alstra'), [props]);
  const sazkuash = useMemo(() => props.filter((p) => packOf(p.id) === 'sazkuash'), [props]);
  const all =
    pack === 'kaykit' ? kaykit : pack === 'alstra' ? alstra : pack === 'sazkuash' ? sazkuash : core;
  const [previewId, setPreviewId] = useState(all[0]?.id ?? 'chest');

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const groupDef = KAYKIT_GROUPS.find((g) => g.id === group);
    return all.filter((p) => {
      if (pack === 'kaykit' && group !== 'all' && groupDef && !groupDef.test(p.id)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q)
        || p.short.toLowerCase().includes(q)
        || p.id.toLowerCase().includes(q)
      );
    });
  }, [all, pack, group, q]);

  const preview =
    filtered.find((p) => p.id === previewId)
    ?? all.find((p) => p.id === previewId)
    ?? filtered[0]
    ?? all[0];

  function switchPack(next: PropPack) {
    const list =
      next === 'kaykit' ? kaykit : next === 'alstra' ? alstra : next === 'sazkuash' ? sazkuash : core;
    setPack(next);
    setQuery('');
    setGroup('all');
    setPreviewId(list[0]?.id ?? 'chest');
  }

  return (
    <ToolSection id="props" title="Props">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={`flex-1 text-xs py-1 rounded font-ui ${
            pack === 'core'
              ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c44]'
              : 'text-[#8a8075] border border-[#2a2a3a]'
          }`}
          onClick={() => switchPack('core')}
        >
          Core · {core.length}
        </button>
        <button
          type="button"
          className={`flex-1 text-xs py-1 rounded font-ui ${
            pack === 'kaykit'
              ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c44]'
              : 'text-[#8a8075] border border-[#2a2a3a]'
          }`}
          onClick={() => switchPack('kaykit')}
        >
          KayKit · {kaykit.length}
        </button>
        <button
          type="button"
          className={`flex-1 text-xs py-1 rounded font-ui ${
            pack === 'alstra'
              ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c44]'
              : 'text-[#8a8075] border border-[#2a2a3a]'
          }`}
          onClick={() => switchPack('alstra')}
        >
          Chests · {alstra.length}
        </button>
        <button
          type="button"
          className={`flex-1 text-xs py-1 rounded font-ui ${
            pack === 'sazkuash'
              ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c44]'
              : 'text-[#8a8075] border border-[#2a2a3a]'
          }`}
          onClick={() => switchPack('sazkuash')}
        >
          Potions · {sazkuash.length}
        </button>
      </div>
      {preview && (
        <PropCatalogPreview propId={preview.id} imageUrl={preview.imageUrl} title={preview.name} />
      )}
      <label className="flex items-center gap-2 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <input
          type="checkbox"
          checked={hidden}
          onChange={(event) => setHidden(event.target.checked)}
        />
        Place hidden
      </label>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${all.length} props…`}
        className="w-full rounded border border-[#2a2a3a] bg-[#12121a] px-1.5 py-1 font-ui text-[11px] text-[#e8e0d0] outline-none focus:border-[#c9a84c88]"
      />
      {pack === 'kaykit' && (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={`rounded px-1.5 py-0.5 font-ui text-[10px] ${
              group === 'all' ? 'bg-[#c9a84c22] text-[#c9a84c]' : 'text-[#8a8075] border border-[#2a2a3a]'
            }`}
            onClick={() => setGroup('all')}
          >
            All · {kaykit.length}
          </button>
          {KAYKIT_GROUPS.map((g) => {
            const n = kaykit.filter((p) => g.test(p.id)).length;
            return (
              <button
                key={g.id}
                type="button"
                className={`rounded px-1.5 py-0.5 font-ui text-[10px] ${
                  group === g.id ? 'bg-[#c9a84c22] text-[#c9a84c]' : 'text-[#8a8075] border border-[#2a2a3a]'
                }`}
                onClick={() => setGroup(g.id)}
              >
                {g.label} · {n}
              </button>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 max-h-80 overflow-y-auto pr-0.5">
        {filtered.map((prop) => (
          <button
            key={prop.id}
            type="button"
            title={prop.name}
            onMouseEnter={() => setPreviewId(prop.id)}
            onFocus={() => setPreviewId(prop.id)}
            onClick={() => placeDungeonProp(prop, hidden)}
            className={`flex items-center gap-1.5 rounded border px-1.5 py-1 text-left ${
              preview?.id === prop.id
                ? 'border-[#c9a84c88] bg-[#c9a84c14]'
                : 'border-[#2a2a3a] hover:border-[#c9a84c66] hover:bg-[#c9a84c14]'
            }`}
          >
            <img
              src={prop.imageUrl}
              alt=""
              width={28}
              height={28}
              draggable={false}
              className="shrink-0"
              style={{
                imageRendering:
                  prop.imageUrl.includes('/kaykit/')
                  || prop.imageUrl.includes('/alstra/')
                  || prop.imageUrl.includes('/assets2d/')
                  || prop.imageUrl.includes('/spajx/')
                    ? 'auto'
                    : 'pixelated',
              }}
            />
            <span className="min-w-0">
              <span className="block truncate font-ui text-[11px] leading-tight text-[#e8e0d0]">
                {tileLabel(prop)}
              </span>
              {pack === 'kaykit' && (
                <span className="block truncate font-ui text-[9px] leading-none text-[#8a8075]">
                  {prop.name}
                </span>
              )}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 font-ui text-[11px] text-[#8a8075] py-2">No props match.</div>
        )}
      </div>
      <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        Core uses the 2D dungeon sprites. KayKit is the 3D pack — hover to preview, click to drop.
        Doors and gates snap to wall openings. Select a prop for Angle / Mount.
      </p>
      {pack === 'alstra' && (
        <>
          <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
            {ALSTRA_CREDIT}
          </p>
          <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
            {ASSETS2D_CREDIT}
          </p>
          <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
            {SPAJX_CREDIT}
          </p>
        </>
      )}
      {pack === 'sazkuash' && (
        <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
          {SAZKUASH_CREDIT}
        </p>
      )}
    </ToolSection>
  );
}
