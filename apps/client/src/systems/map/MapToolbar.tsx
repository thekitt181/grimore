import { useState } from 'react';
import { useMapStore, type MapTool } from './store/mapStore';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { fitMapToScreen } from './hooks/useMapViewport';
import { mapLayerRefs } from './MapCanvas';
import { emitItemUpdate, emitItemRemove } from '@/systems/scene/sceneSync';
import { emitFogUpdate } from '@/systems/scene/fogSync';
import { clsx } from 'clsx';
import { setFogVisibleForSession } from '@/systems/scene/fogActiveSync';

type ToolDef = { id: MapTool; label: string; icon: string; title: string };

const GM_TOOLS: ToolDef[] = [
  { id: 'select',    label: 'Select',  icon: '↖',  title: 'Select, move, resize & rotate' },
  { id: 'pan',       label: 'Pan',     icon: '✋',  title: 'Pan the map (middle-mouse or this tool)' },
  { id: 'fog-reveal',label: 'Reveal',  icon: '☀',  title: 'Reveal fog cells' },
  { id: 'fog-hide',  label: 'Hide',    icon: '🌑', title: 'Hide fog cells' },
  { id: 'wall',      label: 'Wall',    icon: '🧱', title: 'Draw LOS walls (right-click to erase)' },
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
  { id: 'text',          label: 'Text',   icon: 'T', title: 'Place text' },
];

const BTN = 'w-9 h-9 rounded flex items-center justify-center text-sm font-ui transition-all text-[#8a8075] hover:text-[#e8e0d0] hover:bg-[#1c1c28]';
const ACTIVE_BTN = 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c66]';

export function MapToolbar() {
  const {
    activeTool, setTool, revealAll, hideAll,
    drawColor, drawStroke, setDrawColor, setDrawStroke,
    fogEnabled, sessionFogActive,
  } = useMapStore();
  const fogOverlayOn = fogEnabled || sessionFogActive;
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
              title={fogOverlayOn ? 'Fog overlay: ON (click to hide)' : 'Fog overlay: OFF (click to show)'}
              onClick={() => {
                const next = !fogOverlayOn;
                setFogVisibleForSession(next);
                if (!next) {
                  useMapStore.getState().setTool('select');
                }
              }}
              className={clsx(BTN, fogOverlayOn && ACTIVE_BTN)}
            >
              🌫
            </button>
            <button
              title="Reveal entire map"
              onClick={() => {
                setFogVisibleForSession(true);
                revealAll();
                emitFogUpdate();
              }}
              className={BTN}
            >
              ☀
            </button>
            <button
              title="Hide entire map"
              onClick={() => {
                setFogVisibleForSession(true);
                hideAll();
                emitFogUpdate();
              }}
              className={BTN}
            >
              ⬛
            </button>
          </>
        )}
      </div>

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

          <div title="Draw colour" className="flex items-center justify-center">
            <input
              type="color"
              value={drawColor}
              onChange={(e) => setDrawColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0 p-0"
              style={{ background: 'transparent' }}
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
