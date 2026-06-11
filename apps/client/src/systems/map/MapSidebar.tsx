import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { v4 as uuidv4 } from 'uuid';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { emitItemAdd, emitItemUpdate, emitItemRemove } from '@/systems/scene/sceneSync';
import { syncGridToMap } from '@/systems/scene/syncGridToMap';
import type { MapItem, TokenItem, GridType } from '@/systems/scene/types';
import {
  DEFAULT_MAP_GRID_SIZE, DEFAULT_MAP_WIDTH, DEFAULT_MAP_HEIGHT,
  defaultMapGrid, gridSizeForMap,
} from '@/systems/scene/types';
import { DEFAULT_VISION_FT, visionRadiusFromFeet } from '@/systems/map/fogLos';
import { VisionFtDraftInput, parseVisionFt } from '@/systems/map/VisionFtInput';
import { useMapStore } from './store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { fileToDataUrl } from '@/lib/imagePersistence';
import { MAP_ASSET_ACCEPT, isModelUrl } from '@/lib/modelFormats';
import { CompendiumSidebarList } from '@/systems/compendium/CompendiumSidebarList';
import { useDdbStore } from '@/systems/ddb/ddbStore';

/**
 * Right-hand sidebar shown during a session.
 * GM-only: map upload, grid settings, maps list, compendium, add token.
 */
export function MapSidebar() {
  const { myRole, connectedUsers } = useSessionStore();
  const isGM = myRole === 'GM';

  if (!isGM) return null;

  return (
    <aside
      className="flex flex-col h-full min-h-0 shrink-0 overflow-hidden"
      style={{
        width: 440,
        background: 'var(--color-bg-secondary)',
        borderLeft: '1px solid var(--color-border)',
      }}
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Column 1 — map tools, tokens, etc. */}
        <div
          className="flex flex-col min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{ borderRight: '1px solid var(--color-border)' }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
            <GMSidebarContent />
          </div>
        </div>

        {/* Column 2 — compendium (all signed-in users) */}
        <div className="flex flex-col flex-1 min-h-0 w-[220px] shrink-0 overflow-hidden p-2">
          <CompendiumSidebarList />
        </div>
      </div>

      {/* Online — full width footer */}
      <div
        className="shrink-0 p-3 pt-2 border-t"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}
      >
        <h3 className="font-display text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: 'var(--color-accent-gold)' }}>
          Online ({connectedUsers.length})
        </h3>
        <div className="space-y-1.5">
          {connectedUsers.map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: '#4ade80' }} />
              <span className="font-ui text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>{u.username}</span>
              <span className={`ml-auto ${u.role === 'GM' ? 'badge-role-gm' : 'badge-role-player'}`}>{u.role}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ─── GM panel ─────────────────────────────────────────────────────────────────

function GMSidebarContent() {
  const maps = useItemStore(
    useShallow((s) => Object.values(s.items).filter((i): i is MapItem => i.type === 'map')),
  );
  const tokenIds = useItemStore(
    useShallow((s) =>
      Object.values(s.items)
        .filter((i): i is TokenItem => i.type === 'token')
        .map((t) => t.id),
    ),
  );
  const activeMapId = useItemStore((s) => s.activeMapId);
  const activeMap = useItemStore((s) => {
    const id = s.activeMapId;
    if (!id) return null;
    const item = s.items[id];
    return item?.type === 'map' ? item : null;
  });

  const [mapUrl, setMapUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [gridSyncing, setGridSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyBackground(url: string, w: number, h: number) {
    applyMapAsset({ backgroundUrl: url, width: w, height: h });
  }

  function applyModel(url: string, w = DEFAULT_MAP_WIDTH, h = DEFAULT_MAP_HEIGHT) {
    applyMapAsset({ modelUrl: url, width: w, height: h });
  }

  function applyMapAsset(patch: Partial<MapItem> & { width: number; height: number }) {
    const map = getActiveMap();
    const gridDefaults = defaultMapGrid(patch.width, patch.height);
    if (map) {
      const fullPatch: Partial<MapItem> = { ...patch, ...gridDefaults };
      useItemStore.getState().updateItem(map.id, fullPatch);
      emitItemUpdate([{ id: map.id, patch: fullPatch }]);
    } else {
      const m: MapItem = {
        id: uuidv4(), type: 'map', x: 0, y: 0, rotation: 0, width: patch.width, height: patch.height,
        zIndex: 0, locked: false, visible: true, backgroundUrl: patch.backgroundUrl ?? null,
        modelUrl: patch.modelUrl ?? null,
        ...gridDefaults, gridType: 'square', gridColor: 0x2a2a3a, gridOpacity: 0.8,
        showGrid: true, walls: [],
      };
      useItemStore.getState().addItem(m);
      emitItemAdd(m);
    }
  }

  function resetGridToDefault() {
    const map = getActiveMap();
    if (!map) return;
    const patch: Partial<MapItem> = defaultMapGrid(map.width, map.height);
    useItemStore.getState().updateItem(map.id, patch);
    emitItemUpdate([{ id: map.id, patch }]);
  }

  async function handleAutoSyncGrid() {
    const map = getActiveMap();
    if (!map?.backgroundUrl) return;
    setGridSyncing(true);
    const result = await syncGridToMap(map);
    setGridSyncing(false);
    if (!result.ok) {
      alert(result.reason === 'no-image'
        ? 'Add a map image first.'
        : 'Could not detect the printed grid. Use the Calibrate tool (drag one cell) instead.');
    }
  }

  function loadMapFromUrl() {
    const url = mapUrl.trim();
    if (!url) return;
    if (isModelUrl(url)) {
      applyModel(url);
      setMapUrl('');
      return;
    }
    setIsLoading(true);
    const tryLoad = (withCors: boolean) => {
      const img = new Image();
      if (withCors) img.crossOrigin = 'anonymous';
      img.onload = () => {
        applyBackground(url, img.naturalWidth || 1920, img.naturalHeight || 1080);
        setIsLoading(false); setMapUrl('');
      };
      img.onerror = () => {
        if (withCors) tryLoad(false);
        else { alert('Could not load image. Make sure the URL points directly to an image file.'); setIsLoading(false); }
      };
      img.src = url;
    };
    tryLoad(true);
  }

  async function loadMapFromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      if (isModelUrl(url) || isModelUrl(file.name)) {
        applyModel(url);
      } else {
        const img = new Image();
        img.onload = () => applyBackground(url, img.naturalWidth, img.naturalHeight);
        img.src = url;
      }
    } catch {
      alert('Could not read that file.');
    }
    e.target.value = '';
  }

  function setGridType(type: GridType) {
    const map = getActiveMap();
    if (!map) return;
    const patch: Partial<MapItem> = { gridType: type };
    useItemStore.getState().updateItem(map.id, patch);
    emitItemUpdate([{ id: map.id, patch }]);
  }

  function addMap() {
    const rightEdge = Math.max(0, ...maps.map((m) => m.x + m.width));
    const m: MapItem = {
      id: uuidv4(), type: 'map', x: rightEdge + 80, y: 0, rotation: 0, width: 2560, height: 1920,
      zIndex: 0, locked: false, visible: true, backgroundUrl: null,
      gridSize: DEFAULT_MAP_GRID_SIZE, gridType: 'square', gridColor: 0x2a2a3a, gridOpacity: 0.8,
      gridOffsetX: 0, gridOffsetY: 0, showGrid: true, walls: [],
    };
    useItemStore.getState().addItem(m);
    emitItemAdd(m);
  }

  function removeMap(id: string) {
    useItemStore.getState().removeItems([id]);
    emitItemRemove([id]);
  }

  return (
    <>
      {/* Map Upload */}
      <div className="panel space-y-2">
        <h3 className="font-display text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>Map</h3>
        <input type="file" accept={MAP_ASSET_ACCEPT} ref={fileInputRef} className="hidden" onChange={loadMapFromFile} />
        <button className="btn-ghost w-full text-xs py-1.5" onClick={() => fileInputRef.current?.click()}>Upload Image / 3D</button>
        <div className="flex gap-1">
          <input className="input-dark flex-1 text-xs py-1" placeholder="Image or GLB/STL URL..." value={mapUrl}
            onChange={(e) => setMapUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadMapFromUrl()} />
          <button className="btn-primary px-2 py-1 text-xs" onClick={loadMapFromUrl} disabled={isLoading}>{isLoading ? '...' : 'Load'}</button>
        </div>
        <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
          Select a map, then drag its handles to resize/rotate. Drop images or GLB/STL models on the canvas.
        </p>
      </div>

      {/* Grid Settings */}
      {activeMap && (
        <div className="panel space-y-2">
          <h3 className="font-display text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>Grid</h3>
          <div className="flex gap-1">
            {(['square', 'hex'] as const).map((t) => (
              <button key={t} onClick={() => setGridType(t)}
                className={`flex-1 text-xs py-1 rounded font-ui transition-all ${
                  activeMap.gridType === t ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c44]' : 'text-[#8a8075] border border-[#2a2a3a] hover:text-[#e8e0d0]'
                }`}>{t}</button>
            ))}
          </div>
          <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Cell size: {activeMap.gridSize}px (5ft) — resize the map to change distances.
          </p>
          {activeMap.gridSize !== gridSizeForMap(activeMap.width, activeMap.height) && (
            <button className="btn-ghost w-full text-xs py-1.5" onClick={resetGridToDefault}>
              Reset grid for this map
            </button>
          )}
          <button
            className="btn-primary w-full text-xs py-1.5"
            disabled={!activeMap.backgroundUrl || gridSyncing}
            onClick={() => void handleAutoSyncGrid()}
          >
            {gridSyncing ? 'Detecting grid…' : '⊹ Sync grid to map image'}
          </button>
          <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
            Optional: align to the printed grid on your map image. Default scales with map size (~{DEFAULT_MAP_GRID_SIZE}px at {DEFAULT_MAP_WIDTH}×{DEFAULT_MAP_HEIGHT}).
          </p>
        </div>
      )}

      {/* Maps list */}
      <div className="panel space-y-2">
        <h3 className="font-display text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>Maps ({maps.length})</h3>
        <div className="space-y-1">
          {maps.map((m) => (
            <div key={m.id}
              className="flex items-center gap-1.5 rounded px-1.5 py-1 cursor-pointer"
              style={{
                background: m.id === activeMapId ? 'var(--color-bg-tertiary)' : 'transparent',
                border: m.id === activeMapId ? '1px solid var(--color-border-gold)' : '1px solid transparent',
              }}
              onClick={() => {
                useItemStore.getState().setActiveMap(m.id);
                useItemStore.getState().select([m.id], 'set');
                useMapStore.getState().setTool('select');
              }}>
              <span style={{ fontSize: 13 }}>🗺️</span>
              <span className="font-ui text-xs flex-1 truncate" style={{ color: 'var(--color-text-primary)' }}>
                {m.backgroundUrl ? 'Map' : m.modelUrl ? '3D map' : 'Empty map'}
              </span>
              {maps.length > 1 && (
                <button onClick={(e) => { e.stopPropagation(); removeMap(m.id); }}
                  className="text-xs opacity-40 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--color-accent-red-hot)' }} title="Remove map">✕</button>
              )}
            </div>
          ))}
        </div>
        <button className="btn-ghost w-full text-xs py-1" onClick={addMap}>+ Add Map</button>
      </div>

      {/* Quick Add Token */}
      <AddTokenForm />

      <DdbSidebarSection />

      {/* Token list */}
      {tokenIds.length > 0 && (
        <div className="panel space-y-1.5">
          <h3 className="font-display text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: 'var(--color-accent-gold)' }}>
            Tokens ({tokenIds.length})
          </h3>
          {tokenIds.map((id) => <TokenRow key={id} tokenId={id} />)}
        </div>
      )}
    </>
  );
}

function DdbSidebarSection() {
  const setImportModalOpen = useDdbStore((s) => s.setImportModalOpen);
  const setEncounterPanelOpen = useDdbStore((s) => s.setEncounterPanelOpen);
  const setLibraryPanelOpen = useDdbStore((s) => s.setLibraryPanelOpen);
  const setLinkPanelOpen = useDdbStore((s) => s.setLinkPanelOpen);

  return (
    <div className="panel space-y-2">
      <h3 className="font-display text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>
        D&D Beyond
      </h3>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-ghost text-xs py-1 flex-1" onClick={() => setImportModalOpen(true)}>
          Import PC
        </button>
        <button type="button" className="btn-ghost text-xs py-1 flex-1" onClick={() => setEncounterPanelOpen(true)}>
          Encounters
        </button>
        <button type="button" className="btn-ghost text-xs py-1 w-full" onClick={() => setLibraryPanelOpen(true)}>
          Library import
        </button>
        <button type="button" className="btn-ghost text-xs py-1 w-full" onClick={() => setLinkPanelOpen(true)}>
          Account link
        </button>
      </div>
      <p className="font-ui text-[9px] opacity-50">Powered by D&D Beyond</p>
    </div>
  );
}

function AddTokenForm() {
  const [name, setName] = useState('');
  const [hp, setHp] = useState(10);
  const [ac, setAc] = useState(10);
  const [visionDraft, setVisionDraft] = useState(String(DEFAULT_VISION_FT));
  const [imageUrl, setImageUrl] = useState('');

  function handleAdd() {
    if (!name.trim()) return;
    const map = getActiveMap();
    const grid = map?.gridSize ?? DEFAULT_MAP_GRID_SIZE;
    const originX = map?.x ?? 0;
    const originY = map?.y ?? 0;

    const tokens = Object.values(useItemStore.getState().items).filter((i) => i.type === 'token');
    const count = tokens.length;
    const col = count % 10;
    const row = Math.floor(count / 10);
    const px = originX + col * grid;
    const py = originY + row * grid;

    const trimmed = imageUrl.trim();
    const assetPatch = trimmed
      ? (isModelUrl(trimmed) ? { modelUrl: trimmed } : { imageUrl: trimmed })
      : {};
    const token: TokenItem = {
      id: uuidv4(), type: 'token', x: px, y: py, rotation: 0,
      width: grid, height: grid, zIndex: 0, locked: false, visible: true,
      name: name.trim(), ...assetPatch,
      sizeCells: 1, hp, maxHp: hp, tempHp: 0, ac,
      visionRadius: visionRadiusFromFeet(parseVisionFt(visionDraft, DEFAULT_VISION_FT)),
      conditions: [],
    };
    useItemStore.getState().addItem(token);
    emitItemAdd(token);
    setName(''); setImageUrl('');
  }

  return (
    <div className="panel space-y-2">
      <h3 className="font-display text-xs font-semibold tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>Add Token</h3>
      <input className="input-dark text-xs py-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input-dark text-xs py-1" placeholder="Image or GLB/STL URL (optional)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          HP
          <input type="number" className="input-stat" value={hp} min={1} onChange={(e) => setHp(Math.max(1, Number(e.target.value)))} />
        </label>
        <label className="flex items-center gap-1.5 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          AC
          <input type="number" className="input-stat" value={ac} min={0} onChange={(e) => setAc(Math.max(0, Number(e.target.value)))} />
        </label>
        <label className="flex items-center gap-1.5 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Vision (ft)
          <VisionFtDraftInput draft={visionDraft} onDraftChange={setVisionDraft} />
        </label>
      </div>
      <button className="btn-primary w-full text-xs py-1.5" onClick={handleAdd}>+ Place Token</button>
    </div>
  );
}

function TokenRow({ tokenId }: { tokenId: string }) {
  const token = useItemStore((s) => s.items[tokenId]);
  if (!token || token.type !== 'token') return null;

  const tempHp = token.tempHp ?? 0;
  const hpPercent = token.maxHp > 0 ? (token.hp / token.maxHp) * 100 : 0;
  const tempPercent = token.maxHp > 0 ? (tempHp / token.maxHp) * 100 : 0;
  const hpColor = hpPercent > 50 ? '#4ade80' : hpPercent > 25 ? '#facc15' : '#ef4444';

  function remove() {
    useItemStore.getState().removeItems([tokenId]);
    emitItemRemove([tokenId]);
  }

  return (
    <div className="flex items-center gap-2 rounded p-1.5" style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}>
      <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-xs font-ui font-bold"
        style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-accent-gold)' }}>
        {token.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-ui text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>{token.name}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <div className="relative flex-1 h-1 rounded-full overflow-hidden" style={{ background: '#1c1c28' }}>
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${hpPercent}%`, background: hpColor }} />
            {tempHp > 0 && (
              <div
                className="absolute inset-y-0 rounded-full"
                style={{
                  left: `${hpPercent}%`,
                  width: `${Math.min(tempPercent, 100 - hpPercent)}%`,
                  background: '#60a5fa',
                }}
              />
            )}
          </div>
          <span className="font-ui text-xs shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
            {token.hp}/{token.maxHp}{tempHp > 0 ? ` +${tempHp}` : ''} · AC {token.ac ?? 10}
          </span>
        </div>
      </div>
      <button onClick={remove} className="text-xs opacity-40 hover:opacity-100 transition-opacity"
        style={{ color: 'var(--color-accent-red-hot)' }} title="Remove">✕</button>
    </div>
  );
}

