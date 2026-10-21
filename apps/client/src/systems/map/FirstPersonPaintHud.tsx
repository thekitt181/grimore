import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useMapStore } from './store/mapStore';
import { DRAW_COLOR_PRESETS } from './drawColors';
import { useFirstPersonStore, type FpToolMode, type FpDrawShape } from '@/systems/map3d/firstPersonStore';
import { useSessionStore } from '@/store/sessionStore';
import { getSceneCanvasRect } from '@/systems/scene/sceneRefs';
import {
  canFpPaintUndo,
  getFpPaintUndoCount,
  subscribeFpPaintUndo,
  undoFpPaintAction,
} from '@/systems/map3d/fpPaintUndo';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';
const BG = 'var(--color-bg-secondary)';

function ToolBtn({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="px-2 py-1 rounded text-[10px] font-bold transition-all"
      style={{
        background: active ? 'rgba(201,168,76,0.22)' : BG,
        border: `1px solid ${active ? GOLD : BD}`,
        color: active ? GOLD : 'var(--color-text-primary)',
      }}
    >
      {label}
    </button>
  );
}

/** FP spray / breach / erase controls — beside the FP dock toggle while walking. */
export function FirstPersonPaintHud() {
  const viewMode = useMapStore((s) => s.viewMode);
  const enabled = useFirstPersonStore((s) => s.enabled);
  const tool = useFirstPersonStore((s) => s.tool);
  const setTool = useFirstPersonStore((s) => s.setTool);
  const drawShape = useFirstPersonStore((s) => s.drawShape);
  const setDrawShape = useFirstPersonStore((s) => s.setDrawShape);
  const brushSize = useFirstPersonStore((s) => s.brushSize);
  const setBrushSize = useFirstPersonStore((s) => s.setBrushSize);
  const drawColor = useMapStore((s) => s.drawColor);
  const setDrawColor = useMapStore((s) => s.setDrawColor);
  const isGM = useSessionStore((s) => s.myRole === 'GM');
  const undoCount = useSyncExternalStore(subscribeFpPaintUndo, getFpPaintUndoCount, getFpPaintUndoCount);
  const canUndo = useSyncExternalStore(subscribeFpPaintUndo, canFpPaintUndo, canFpPaintUndo);

  // Crosshair on the 3D canvas center (= camera ray NDC 0,0), not the full window.
  const crosshairRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewMode !== '3d' || !enabled || tool === 'none') return;
    let raf = 0;
    const sync = () => {
      const el = crosshairRef.current;
      const rect = getSceneCanvasRect();
      if (el && rect && rect.width > 0 && rect.height > 0) {
        el.style.left = `${rect.left + rect.width / 2}px`;
        el.style.top = `${rect.top + rect.height / 2}px`;
        el.style.display = 'block';
      } else if (el) {
        el.style.display = 'none';
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [viewMode, enabled, tool]);

  if (viewMode !== '3d' || !enabled) return null;

  function toggle(next: FpToolMode) {
    setTool(tool === next ? 'none' : next);
  }

  function setShape(next: FpDrawShape) {
    setDrawShape(next);
  }

  const hair = tool === 'erase' ? '#ef4444' : GOLD;

  return (
    <>
      {tool !== 'none' && (
        <div
          ref={crosshairRef}
          className="pointer-events-none fixed z-[35]"
          aria-hidden
          style={{
            left: 0,
            top: 0,
            width: 18,
            height: 18,
            transform: 'translate(-50%, -50%)',
            display: 'none',
          }}
        >
          <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2" style={{ background: hair, opacity: 0.9 }} />
          <div className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2" style={{ background: hair, opacity: 0.9 }} />
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{ width: 8, height: 8, borderColor: hair, opacity: 0.75 }}
          />
        </div>
      )}

      <div
        className="flex flex-col gap-1.5 rounded-lg shadow-panel px-2 py-2 pointer-events-auto"
        style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}`, minWidth: '8rem' }}
      >
        <div className="flex flex-wrap gap-1">
          <ToolBtn
            active={tool === 'spray'}
            label="Spray"
            title="Hold LMB to paint — ghost shows before release"
            onClick={() => toggle('spray')}
          />
          <ToolBtn
            active={tool === 'erase'}
            label="Erase"
            title="Hold LMB to erase spray paint under the crosshair"
            onClick={() => toggle('erase')}
          />
          {isGM && (
            <ToolBtn
              active={tool === 'breach'}
              label="Breach"
              title="Hold LMB on a wall — circle/freehand ghost, release to cut"
              onClick={() => toggle('breach')}
            />
          )}
          <button
            type="button"
            title={canUndo ? `Undo last spray/breach (Ctrl+Z) — ${undoCount} left` : 'Nothing to undo'}
            disabled={!canUndo}
            onClick={() => undoFpPaintAction()}
            className="px-2 py-1 rounded text-[10px] font-bold transition-all disabled:opacity-40"
            style={{
              background: BG,
              border: `1px solid ${BD}`,
              color: canUndo ? GOLD : 'var(--color-text-secondary)',
            }}
          >
            Undo{undoCount > 0 ? ` (${undoCount})` : ''}
          </button>
        </div>

        {tool !== 'none' && tool !== 'erase' && (
          <>
            <div className="flex gap-1">
              <ToolBtn
                active={drawShape === 'circle'}
                label="Circle"
                title="Click center, drag radius — preview before release"
                onClick={() => setShape('circle')}
              />
              <ToolBtn
                active={drawShape === 'freehand'}
                label="Free"
                title="Freehand stroke — preview before release"
                onClick={() => setShape('freehand')}
              />
            </div>

            {tool === 'spray' && (
              <div className="flex flex-wrap gap-1">
                {DRAW_COLOR_PRESETS.slice(0, 6).map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => setDrawColor(c)}
                    className="w-4 h-4 rounded-sm"
                    style={{
                      background: c,
                      border: `1px solid ${drawColor === c ? GOLD : BD}`,
                      boxShadow: drawColor === c ? `0 0 0 1px ${GOLD}` : undefined,
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={drawColor}
                  onChange={(e) => setDrawColor(e.target.value)}
                  className="w-5 h-4 p-0 border-0 bg-transparent cursor-pointer"
                  title="Custom colour"
                />
              </div>
            )}

            <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
              Size
              <input
                type="range"
                min={4}
                max={48}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="flex-1 accent-[var(--color-accent-gold)]"
              />
              <span className="w-5 tabular-nums">{brushSize}</span>
            </label>
            <p className="text-[9px] leading-tight" style={{ color: 'var(--color-text-muted, #888)' }}>
              {drawShape === 'circle'
                ? 'Click once to look, then hold LMB → drag size → release'
                : 'Click once to look, then hold LMB and draw → release'}
            </p>
          </>
        )}

        {tool === 'erase' && (
          <p className="text-[9px] leading-tight" style={{ color: 'var(--color-text-muted, #888)' }}>
            Hold LMB on paint to remove it
          </p>
        )}
      </div>
    </>
  );
}
