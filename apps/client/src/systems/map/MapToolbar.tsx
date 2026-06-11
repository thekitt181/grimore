import { useState } from 'react';
import { useMapStore, type MapTool } from './store/mapStore';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { fitMapToScreen } from './hooks/useMapViewport';
import { mapLayerRefs } from './MapCanvas';
import { emitItemUpdate, emitItemRemove } from '@/systems/scene/sceneSync';
import { clsx } from 'clsx';
import { setFogVisibleForSession } from '@/systems/scene/fogActiveSync';
import { DRAW_COLOR_PRESETS, DEFAULT_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE, MIN_TEXT_FONT_SIZE } from './drawColors';

type ToolDef = { id: MapTool; label: string; icon: string; title: string };

const GM_TOOLS: ToolDef[] = [
  { id: 'select',    label: 'Select',  icon: '↖',  title: 'Select, move, resize & rotate' },
  { id: 'pan',       label: 'Pan',     icon: '✋',  title: 'Pan the map (middle-mouse or this tool)' },
  { id: 'fog-reveal',label: 'Reveal',  icon: '☀',  title: 'Reveal fog cells' },
  { id: 'fog-hide',  label: 'Hide',    icon: '🌑', title: 'Hide fog cells' },
  { id: 'wall',      label: 'Wall',    icon: '🧱', title: 'Draw LOS walls (GM). Use Eraser to remove wall segments.' },
  { id: 'measure',   label: 'Measure', icon: '📏', title: 'Measure distance' },
  { id: 'calibrate', label: 'Calibrate', icon: '⊹', title: 'Calibrate grid — drag a rectangle over one cell' },
];

const PLAYER_TOOLS: ToolDef[] = [
  { id: 'select',  label: 'Select',  icon: '↖',  title: 'Select & move your token' },
  { id: 'pan',     label: 'Pan',     icon: '✋',  title: 'Pan the map (pinch to zoom)' },
  { id: 'measure', label: 'Measure', icon: '📏', title: 'Measure distance' },
];

const DRAW_TOOLS: ToolDef[] = [
  { id: 'draw-freehand', label: 'Pen',    icon: '✏', title: 'Freehand draw' },
  { id: 'draw-rect',     label: 'Rect',   icon: '▭', title: 'Draw rectangle' },
  { id: 'draw-circle',   label: 'Circle', icon: '○', title: 'Draw circle' },
  { id: 'draw-arrow',    label: 'Arrow',  icon: '→', title: 'Draw arrow' },
  { id: 'text',          label: 'Text',   icon: 'T', title: 'Place text label (DM & players)' },
  { id: 'eraser',        label: 'Eraser', icon: '⌫', title: 'Erase drawings, text, and walls (GM: all; players: own marks)' },
];

const BTN = 'w-9 h-9 rounded flex items-center justify-center text-sm font-ui transition-all text-[#8a8075] hover:text-[#e8e0d0] hover:bg-[#1c1c28]';
const ACTIVE_BTN = 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c66]';

export function MapToolbar() {
  const activeTool = useMapStore((s) => s.activeTool);
  const setTool = useMapStore((s) => s.setTool);
  const drawColor = useMapStore((s) => s.drawColor);
  const drawStroke = useMapStore((s) => s.drawStroke);
  const textFontSize = useMapStore((s) => s.textFontSize);
  const setDrawColor = useMapStore((s) => s.setDrawColor);
  const setDrawStroke = useMapStore((s) => s.setDrawStroke);
  const setTextFontSize = useMapStore((s) => s.setTextFontSize);
  const fogEnabled = useMapStore((s) => s.fogEnabled);
  const sessionFogActive = useMapStore((s) => s.sessionFogActive);
  const fogOverlayOn = fogEnabled || sessionFogActive;
  const viewMode = useMapStore((s) => s.viewMode);
  const toggleViewMode = useMapStore((s) => s.toggleViewMode);
  const autoExtrudeWalls = useMapStore((s) => s.autoExtrudeWalls);
  const wallHeightCells = useMapStore((s) => s.wallHeightCells);
  const setAutoExtrudeWalls = useMapStore((s) => s.setAutoExtrudeWalls);
  const setWallHeightCells = useMapStore((s) => s.setWallHeightCells);
  const snapToGrid = useItemStore((s) => s.snapToGrid);
  const setSnap = useItemStore((s) => s.setSnap);
  const items = useItemStore((s) => s.items);
  const { myRole } = useSessionStore();
  const isGM = myRole === 'GM';
  const tools = isGM ? GM_TOOLS : PLAYER_TOOLS;

  const [showDrawPanel, setShowDrawPanel] = useState(false);
  const isDrawTool = DRAW_TOOLS.some((t) => t.id === activeTool);

  const activeMap = getActiveMap();
  const showGrid = activeMap?.showGrid ?? true;

  function handleFit() {
    const app = mapLayerRefs.app.current;
    const world = mapLayerRefs.world.current;
    if (app && world) fitMapToScreen(app, world);
  }

  function handleToggleGrid() {
    const map = getActiveMap();
    if (!map) return;
    const patch = { showGrid: !map.showGrid };
    useItemStore.getState().updateItem(map.id, patch);
    emitItemUpdate([{ id: map.id, patch }]);
  }

  function handleClearDrawings() {
    const ids = Object.values(items)
      .filter((i) => i.type === 'drawing' || i.type === 'text')
      .map((i) => i.id);
    if (!ids.length) return;
    useItemStore.getState().removeItems(ids);
    emitItemRemove(ids);
  }

  return (
    <div className="flex gap-1">
      {/* Main tool column */}
      <div
        className="flex flex-col gap-1 p-2 rounded-lg shadow-panel"
        style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', width: 52 }}
      >
        {tools.map((tool) => (
          <button
            key={tool.id}
            title={tool.title}
            onClick={() => { setTool(tool.id); setShowDrawPanel(false); }}
            className={clsx('w-9 h-9 rounded flex items-center justify-center text-base font-ui transition-all',
              activeTool === tool.id ? ACTIVE_BTN : 'text-[#8a8075] hover:text-[#e8e0d0] hover:bg-[#1c1c28]'
            )}
          >
            {tool.icon}
          </button>
        ))}

        <div className="gold-divider my-1" />
        <button
          title="Drawing tools"
          onClick={() => setShowDrawPanel((p) => !p)}
          className={clsx(BTN, (showDrawPanel || isDrawTool) && ACTIVE_BTN)}
        >
          ✏
        </button>

        <div className="gold-divider my-1" />

        {/* Snap to grid */}
        <button
          title={snapToGrid ? 'Snap to grid: ON' : 'Snap to grid: OFF'}
          onClick={() => setSnap(!snapToGrid)}
          className={clsx(BTN, snapToGrid && ACTIVE_BTN)}
        >
          🧲
        </button>

        {/* Fit */}
        <button title="Fit map to screen" onClick={handleFit} className={BTN}>⛶</button>

        {/* 2D / 3D view */}
        <button
          title={viewMode === '3d' ? 'Switch to 2D map' : 'Switch to 3D map (orbit, extruded walls)'}
          onClick={toggleViewMode}
          className={clsx(BTN, viewMode === '3d' && ACTIVE_BTN)}
        >
          {viewMode === '3d' ? '2D' : '3D'}
        </button>

        {/* Grid toggle */}
        {isGM && (
          <button
            title="Toggle grid"
            onClick={handleToggleGrid}
            className={clsx(BTN, showGrid && ACTIVE_BTN)}
          >
            ⊞
          </button>
        )}

        {isGM && (
          <>
            <div className="gold-divider my-1" />
            <button
              title={fogOverlayOn ? 'Fog: ON — click to turn off for players' : 'Fog: OFF — click to turn on'}
              onClick={() => {
                const next = !fogOverlayOn;
                setFogVisibleForSession(next);
                if (next) {
                  setTool('fog-reveal');
                } else {
                  setTool('select');
                }
              }}
              className={clsx(
                'w-9 h-9 rounded flex flex-col items-center justify-center font-ui transition-all',
                fogOverlayOn
                  ? 'bg-[#c9a84c33] text-[#c9a84c] ring-2 ring-[#c9a84c] shadow-[0_0_10px_rgba(201,168,76,0.35)]'
                  : 'text-[#6b6560] hover:text-[#8a8075] hover:bg-[#1c1c28] ring-1 ring-[#2a2a3a]',
              )}
            >
              <span className="text-sm leading-none" aria-hidden>
                {fogOverlayOn ? '🌫' : '🗺'}
              </span>
              <span
                className="text-[7px] font-bold tracking-widest mt-0.5"
                style={{ color: fogOverlayOn ? '#c9a84c' : '#6b6560' }}
              >
                {fogOverlayOn ? 'ON' : 'OFF'}
              </span>
            </button>
          </>
        )}
      </div>

      {viewMode === '3d' && isGM && (
        <div
          className="flex flex-col gap-2 p-2 rounded-lg shadow-panel ml-1"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', width: 120 }}
        >
          <span className="font-ui text-[10px] tracking-wide" style={{ color: 'var(--color-accent-gold)' }}>
            3D MAP
          </span>
          <label className="flex items-center gap-1.5 font-ui text-[10px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            <input
              type="checkbox"
              checked={autoExtrudeWalls}
              onChange={(e) => setAutoExtrudeWalls(e.target.checked)}
              className="accent-[#c9a84c]"
            />
            Extrude walls
          </label>
          <label className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            Wall height ({wallHeightCells.toFixed(1)} cells)
            <input
              type="range"
              min={0.5}
              max={6}
              step={0.5}
              value={wallHeightCells}
              onChange={(e) => setWallHeightCells(Number(e.target.value))}
              className="w-full accent-[#c9a84c] mt-1"
              disabled={!autoExtrudeWalls}
            />
          </label>
          <span className="font-ui text-[9px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
            Drag to orbit · scroll to zoom
          </span>
        </div>
      )}

      {/* Draw sub-panel */}
      {showDrawPanel && (
        <div
          className="flex flex-col gap-1 p-2 rounded-lg shadow-panel"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', width: 52 }}
        >
          {DRAW_TOOLS.map((tool) => (
            <button
              key={tool.id}
              title={tool.title}
              onClick={() => setTool(tool.id)}
              className={clsx('w-9 h-9 rounded flex items-center justify-center text-sm font-ui transition-all',
                activeTool === tool.id ? ACTIVE_BTN : 'text-[#8a8075] hover:text-[#e8e0d0] hover:bg-[#1c1c28]'
              )}
            >
              {tool.icon}
            </button>
          ))}

          <div className="gold-divider my-1" />

          <div className="grid grid-cols-3 gap-0.5 px-0.5" title="Colour palette">
            {DRAW_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => setDrawColor(c)}
                className="w-4 h-4 rounded border"
                style={{
                  background: c,
                  borderColor: drawColor === c ? '#c9a84c' : 'var(--color-border)',
                  boxShadow: drawColor === c ? '0 0 0 1px #c9a84c' : undefined,
                }}
              />
            ))}
          </div>

          <div title="Custom colour" className="flex items-center justify-center mt-0.5">
            <input
              type="color"
              value={drawColor}
              onChange={(e) => setDrawColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0 p-0"
              style={{ background: 'transparent' }}
            />
          </div>

          <div className="flex flex-col items-center gap-0.5 px-1 mt-0.5">
            <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>
              Text {textFontSize}px
            </span>
            <input
              type="range"
              min={MIN_TEXT_FONT_SIZE}
              max={MAX_TEXT_FONT_SIZE}
              step={1}
              value={textFontSize}
              onChange={(e) => setTextFontSize(Number(e.target.value))}
              className="w-full accent-[#c9a84c]"
              title="Text size for new labels"
            />
          </div>

          <div className="flex flex-col items-center gap-0.5 px-1">
            <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>
              {drawStroke}px
            </span>
            <input
              type="range" min={1} max={12} step={1}
              value={drawStroke}
              onChange={(e) => setDrawStroke(Number(e.target.value))}
              className="w-full accent-[#c9a84c]"
              style={{ writingMode: 'vertical-lr', height: 52, width: 16 }}
            />
          </div>

          {isGM && (
            <>
              <div className="gold-divider my-1" />
              <button
                title="Clear all drawings"
                onClick={handleClearDrawings}
                className={clsx(BTN, 'text-[#ef4444] hover:bg-[#7f1d1d33]')}
              >
                🗑
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
