import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useItemStore } from './store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { clientToWorld } from './sceneRefs';
import { hitTest, hitTestMap, isMapGroundHit, isCanvasContextEvent, isCanvasPointerEvent } from './hitTest';
import { emitItemAdd, emitItemUpdate } from './sceneSync';
import { deleteCurrentSelection } from './deleteSelection';
import { syncGridToMap } from './syncGridToMap';
import type { HandoutInventoryTarget, SessionUser } from '@grimoire/shared';
import type { Item, MapItem, TokenItem, HandoutItem } from './types';
import { isHpHiddenFromPlayers } from './types';
import { visionFeet, visionRadiusFromFeet } from '@/systems/map/fogLos';
import { applyTokenHpToCombatants, applyTokenConditionsToCombatants } from '@/systems/initiative/initiativeTokenSync';
import { useCombatStore } from '@/systems/combat/combatStore';
import { useDdbStore } from '@/systems/ddb/ddbStore';
import { applyDamage, applyHeal, readTempHp } from '@/systems/initiative/hpUtils';
import { useCompendiumUiStore } from '@/systems/compendium/compendiumStore';
import { SummonMonsterPicker } from '@/systems/compendium/SummonMonsterPicker';
import { PlaceItemHandoutPicker } from '@/systems/compendium/PlaceItemHandoutPicker';
import { revealHandoutToPlayers } from '@/systems/compendium/revealHandout';
import { useHandoutViewerStore } from '@/systems/compendium/handoutViewerStore';
import { getPersistSessionId } from './sessionPersistence';
import { DraggablePanel } from '@/components/DraggablePanel';
import { isMobileClient } from '@/lib/socket';
import { isDdbPcToken } from '@/systems/ddb/ddbTokenUtils';
import { TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '@grimoire/shared';
import type { TimeOfDay, WeatherOverlay } from '@grimoire/shared';
import { useSceneMediaStore } from './media/sceneMediaStore';
import { emitSessionTimeOfDay, emitSessionWeather } from './media/useSceneMedia';
import { extractApiError } from '@/lib/apiError';

const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated',
  'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained',
  'Stunned', 'Unconscious', 'Exhaustion',
];

interface ItemMenuState { x: number; y: number; kind: 'item' }
interface MapMenuState {
  x: number;
  y: number;
  kind: 'map';
  worldX: number;
  worldY: number;
}
type MenuState = ItemMenuState | MapMenuState;

function resolveContextMenu(
  clientX: number,
  clientY: number,
  isGM: boolean,
  shiftKey = false,
): MenuState | null {
  const { x: wx, y: wy } = clientToWorld(clientX, clientY);
  const all = Object.values(useItemStore.getState().items) as Item[];
  const visible = isGM ? all : all.filter((i) => i.visible);
  const hit = hitTest(visible, wx, wy, { includeLocked: true });

  if (isMapGroundHit(hit)) {
    if (!isGM) return null;
    const mapAt = hit?.type === 'map' ? hit : hitTestMap(visible, wx, wy);
    // Right-click map surface: select map for lock/unlock/delete (shift = ground menu).
    if (!shiftKey && mapAt?.type === 'map') {
      useItemStore.getState().select([mapAt.id], 'set');
      return { x: clientX, y: clientY, kind: 'item' };
    }
    useItemStore.getState().clearSelection();
    return { x: clientX, y: clientY, kind: 'map', worldX: wx, worldY: wy };
  }

  if (!hit) return null;

  if (!isGM) {
    if (hit.type === 'handout') {
      if (!useItemStore.getState().selectedIds.includes(hit.id)) {
        useItemStore.getState().select([hit.id], 'set');
      }
      return { x: clientX, y: clientY, kind: 'item' };
    }
    if (hit.type === 'token' && isDdbPcToken(hit as TokenItem)) {
      if (!useItemStore.getState().selectedIds.includes(hit.id)) {
        useItemStore.getState().select([hit.id], 'set');
      }
      return { x: clientX, y: clientY, kind: 'item' };
    }
    return null;
  }

  if (!useItemStore.getState().selectedIds.includes(hit.id)) {
    useItemStore.getState().select([hit.id], 'set');
  }
  return { x: clientX, y: clientY, kind: 'item' };
}

interface FloatingPickerState {
  kind: 'monster' | 'item';
  worldX: number;
  worldY: number;
  anchorX: number;
  anchorY: number;
}

const MENU_WIDTH = 210;
const MAP_MENU_WIDTH = 240;
const VIEWPORT_PAD = 8;

function clampMenuPosition(
  anchorX: number,
  anchorY: number,
  menuWidth: number,
  menuHeight: number,
): { left: number; top: number } {
  const maxLeft = window.innerWidth - menuWidth - VIEWPORT_PAD;
  const maxTop = window.innerHeight - menuHeight - VIEWPORT_PAD;
  return {
    left: Math.max(VIEWPORT_PAD, Math.min(anchorX, maxLeft)),
    top: Math.max(VIEWPORT_PAD, Math.min(anchorY, maxTop)),
  };
}

export function ItemContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [floatingPicker, setFloatingPicker] = useState<FloatingPickerState | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const openTokenActions = useCombatStore((s) => s.openTokenActions);
  const openPcActions = useDdbStore((s) => s.openPcActions);
  const openSheet = useDdbStore((s) => s.openSheet);
  const setImportModalOpen = useDdbStore((s) => s.setImportModalOpen);
  const ref = useRef<HTMLDivElement>(null);

  const selectedIds = useItemStore((s) => s.selectedIds);
  const selectedWallIndices = useItemStore((s) => s.selectedWallIndices);
  const items = useItemStore((s) => s.items);
  const myRole = useSessionStore((s) => s.myRole);
  const connectedUsers = useSessionStore((s) => s.connectedUsers);
  const isGM = myRole === 'GM';

  const selected = selectedIds.map((id) => items[id]).filter(Boolean) as Item[];
  const single = selected.length === 1 ? selected[0]! : null;

  // Right-click on canvas → item menu, or map menu (GM) with summon as an option
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      if (!isCanvasContextEvent(e)) return;
      const next = resolveContextMenu(e.clientX, e.clientY, isGM, e.shiftKey);
      if (!next) return;
      e.preventDefault();
      setMenu(next);
    }
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [isGM]);

  // Long-press on mobile (no right-click)
  useEffect(() => {
    if (!isMobileClient()) return;

    const LONG_PRESS_MS = 520;
    const MOVE_CANCEL_PX = 14;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let originX = 0;
    let originY = 0;
    let activePointerId: number | null = null;

    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      activePointerId = null;
    }

    function onPointerDown(e: PointerEvent) {
      if (!isCanvasPointerEvent(e) || e.pointerType === 'mouse') return;
      clearTimer();
      originX = e.clientX;
      originY = e.clientY;
      activePointerId = e.pointerId;

      timer = setTimeout(() => {
        timer = null;
        const next = resolveContextMenu(originX, originY, isGM);
        if (!next) return;
        navigator.vibrate?.(12);
        setMenu(next);
      }, LONG_PRESS_MS);
    }

    function onPointerMove(e: PointerEvent) {
      if (timer == null || e.pointerId !== activePointerId) return;
      if (Math.hypot(e.clientX - originX, e.clientY - originY) > MOVE_CANCEL_PX) {
        clearTimer();
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (e.pointerId === activePointerId) clearTimer();
    }

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      clearTimer();
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isGM]);

  // Close on outside click
  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menu]);

  // Measure actual menu height and keep it fully on-screen.
  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPosition(null);
      return;
    }
    const el = ref.current;
    const { width, height } = el.getBoundingClientRect();
    setPosition(clampMenuPosition(menu.x, menu.y, width || MENU_WIDTH, height));
  }, [menu, selected.length, single?.type, isGM]);

  function openFloatingPicker(
    kind: FloatingPickerState['kind'],
    worldX: number,
    worldY: number,
    anchorX: number,
    anchorY: number,
  ) {
    setMenu(null);
    setFloatingPicker({ kind, worldX, worldY, anchorX, anchorY });
  }

  if (floatingPicker) {
    const { kind, worldX, worldY, anchorX, anchorY } = floatingPicker;
    const defaultPosition = {
      x: Math.max(VIEWPORT_PAD, Math.min(anchorX, window.innerWidth - 280 - VIEWPORT_PAD)),
      y: Math.max(VIEWPORT_PAD, anchorY),
    };
    return (
      <DraggablePanel
        title={kind === 'monster' ? 'Summon monster' : 'Place item handout'}
        subtitle="Search compendium, click to place on map"
        onClose={() => setFloatingPicker(null)}
        defaultPosition={defaultPosition}
        width={280}
        zIndex={170}
      >
        {kind === 'monster' ? (
          <SummonMonsterPicker
            worldX={worldX}
            worldY={worldY}
            onSummon={() => setFloatingPicker(null)}
          />
        ) : (
          <PlaceItemHandoutPicker
            worldX={worldX}
            worldY={worldY}
            onPlace={() => setFloatingPicker(null)}
          />
        )}
      </DraggablePanel>
    );
  }

  if (!menu) return null;

  function close() { setMenu(null); }

  const menuWidth = menu.kind === 'map' ? MAP_MENU_WIDTH : MENU_WIDTH;

  // ─── Map ground menu (GM) ───────────────────────────────────────────────────
  if (menu.kind === 'map') {
    const Btn = ({ label, onClick }: { label: string; onClick: () => void }) => (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-1.5 text-xs font-ui rounded transition-colors"
        style={{ color: 'var(--color-text-primary)' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        {label}
      </button>
    );

    return (
      <div
        ref={ref}
        className="fixed z-50 rounded-lg shadow-panel py-1 overflow-y-auto"
        style={{
          left: position?.left ?? menu.x,
          top: position?.top ?? menu.y,
          width: menuWidth,
          maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
          visibility: position ? 'visible' : 'hidden',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <>
          <div className="px-3 py-1 font-display text-xs tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>
            Map
          </div>
          <div className="gold-divider my-1" />
          <Btn
            label="🐉 Summon monster here"
            onClick={() => openFloatingPicker('monster', menu.worldX, menu.worldY, menu.x, menu.y)}
          />
          <Btn
            label="📜 Place item handout here"
            onClick={() => openFloatingPicker('item', menu.worldX, menu.worldY, menu.x, menu.y)}
          />
          <Btn
            label="📌 Paste"
            onClick={() => {
              const created = useItemStore.getState().paste();
              created.forEach((c) => emitItemAdd(c));
              close();
            }}
          />
          <MapWeatherMenuSection onDone={close} />
          <MapTimeMenuSection onDone={close} />
        </>
      </div>
    );
  }

  if (selected.length === 0) return null;

  if (!isGM) {
    const Btn = ({ label, onClick }: { label: string; onClick: () => void }) => (
      <button
        onClick={onClick}
        className="w-full text-left px-3 py-1.5 text-xs font-ui rounded transition-colors"
        style={{ color: 'var(--color-text-primary)' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        {label}
      </button>
    );

    const pcToken =
      single?.type === 'token' && isDdbPcToken(single as TokenItem)
        ? (single as TokenItem)
        : null;

    return (
      <div
        ref={ref}
        className="fixed z-50 rounded-lg shadow-panel py-1 overflow-y-auto"
        style={{
          left: position?.left ?? menu.x,
          top: position?.top ?? menu.y,
          width: MENU_WIDTH,
          maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
          visibility: position ? 'visible' : 'hidden',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="px-3 py-1 font-display text-xs tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>
          {pcToken ? pcToken.name : single?.type ?? 'item'}
        </div>
        <div className="gold-divider my-1" />
        {pcToken && (
          <>
            <Btn label="⚔ Character actions" onClick={() => {
              openPcActions(pcToken);
              close();
            }} />
            <Btn label="📜 Character sheet" onClick={() => {
              openSheet(pcToken);
              close();
            }} />
          </>
        )}
        {single?.type === 'handout' && (
          <Btn label="📖 View item" onClick={() => {
            useHandoutViewerStore.getState().openHandout(single as HandoutItem);
            close();
          }} />
        )}
      </div>
    );
  }

  const ids = selected.map((i) => i.id);
  const allLocked = selected.every((i) => i.locked);
  const allHidden = selected.every((i) => !i.visible);

  function patchAll(patch: Partial<Item>) {
    const updates = ids.map((id) => ({ id, patch }));
    useItemStore.getState().updateItems(updates);
    emitItemUpdate(updates);
  }

  function toggleLock() { patchAll({ locked: !allLocked } as Partial<Item>); }
  function toggleHide() { patchAll({ visible: allHidden } as Partial<Item>); close(); }

  function duplicate() {
    const created = useItemStore.getState().duplicate(ids);
    created.forEach((c) => emitItemAdd(c));
    close();
  }
  function copy() { useItemStore.getState().copy(ids); close(); }
  function paste() {
    const created = useItemStore.getState().paste();
    created.forEach((c) => emitItemAdd(c));
    close();
  }
  function del() {
    deleteCurrentSelection();
    close();
  }

  function zorder(action: 'front' | 'forward' | 'backward' | 'back') {
    const store = useItemStore.getState();
    for (const id of ids) {
      if (action === 'front') store.bringToFront(id);
      else if (action === 'forward') store.bringForward(id);
      else if (action === 'backward') store.sendBackward(id);
      else store.sendToBack(id);
    }
    const updates = ids.map((id) => ({ id, patch: { zIndex: useItemStore.getState().items[id]!.zIndex } as Partial<Item> }));
    emitItemUpdate(updates);
  }

  const Btn = ({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) => (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-xs font-ui rounded transition-colors"
      style={{ color: danger ? 'var(--color-accent-red-hot)' : 'var(--color-text-primary)' }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-lg shadow-panel py-1 overflow-y-auto"
      style={{
        left: position?.left ?? menu.x,
        top: position?.top ?? menu.y,
        width: MENU_WIDTH,
        maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
        visibility: position ? 'visible' : 'hidden',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="px-3 py-1 font-display text-xs tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>
        {selectedWallIndices.length > 0 && selected.length === 0
          ? `${selectedWallIndices.length} walls`
          : selectedWallIndices.length > 0
            ? `${selected.length} items · ${selectedWallIndices.length} walls`
            : selected.length > 1
              ? `${selected.length} items`
              : single?.type}
      </div>
      <div className="gold-divider my-1" />

      <Btn label={allLocked ? '🔓 Unlock' : '🔒 Lock'} onClick={toggleLock} />
      {isGM && <Btn label={allHidden ? '👁 Show to players' : '🙈 Hide from players'} onClick={toggleHide} />}
      <Btn label="⧉ Duplicate" onClick={duplicate} />
      <Btn label="📋 Copy" onClick={copy} />
      <Btn label="📌 Paste" onClick={paste} />

      <div className="gold-divider my-1" />
      <Btn label="⤒ Bring to Front" onClick={() => zorder('front')} />
      <Btn label="↑ Forward" onClick={() => zorder('forward')} />
      <Btn label="↓ Backward" onClick={() => zorder('backward')} />
      <Btn label="⤓ Send to Back" onClick={() => zorder('back')} />

      {single?.type === 'map' && isGM && (
        <>
          <div className="gold-divider my-1" />
          <MapWeatherMenuSection onDone={close} />
          <MapTimeMenuSection onDone={close} />
          <div className="gold-divider my-1" />
          <Btn label="⊹ Auto-sync grid" onClick={() => {
            void syncGridToMap(single as MapItem).then((r) => {
              if (!r.ok) alert('Could not auto-detect grid. Try Calibrate (drag one cell).');
              close();
            });
          }} />
          <Btn label="⊹ Calibrate grid (manual)" onClick={() => { useMapStore.getState().setTool('calibrate'); close(); }} />
        </>
      )}

      {single?.type === 'token' && isGM && <TokenExtras token={single as TokenItem} />}

      {single?.type === 'token' && isGM && (
        <TokenOwnerAssign
          token={single as TokenItem}
          players={connectedUsers}
          onDone={close}
        />
      )}

      {single?.type === 'token' && (single as TokenItem).monsterId && isGM && (
        <>
          <div className="gold-divider my-1" />
          <Btn label="⚔ Monster actions" onClick={() => {
            openTokenActions(single as TokenItem);
            close();
          }} />
          <Btn label="📖 View stat block" onClick={() => {
            useCompendiumUiStore.getState().setTab('monsters');
            useCompendiumUiStore.getState().selectMonster((single as TokenItem).monsterId!);
            close();
          }} />
        </>
      )}

      {single?.type === 'token' && isDdbPcToken(single as TokenItem) && isGM && (
        <>
          <div className="gold-divider my-1" />
          <Btn label="⚔ Character actions" onClick={() => {
            openPcActions(single as TokenItem);
            close();
          }} />
          <Btn label="📜 Character sheet" onClick={() => {
            openSheet(single as TokenItem);
            close();
          }} />
        </>
      )}

      {single?.type === 'token' && isGM && !(single as TokenItem).ddbCharacterId && (
        <>
          <div className="gold-divider my-1" />
          <Btn label="🔗 Link D&D Beyond character" onClick={() => {
            setImportModalOpen(true, single!.id);
            close();
          }} />
        </>
      )}

      {single?.type === 'handout' && isGM && (
        <>
          <div className="gold-divider my-1" />
          <Btn label="📖 View item" onClick={() => {
            useHandoutViewerStore.getState().openHandout(single as HandoutItem);
            close();
          }} />
          <Btn label="📖 Open in compendium" onClick={() => {
            useCompendiumUiStore.getState().setTab('items');
            useCompendiumUiStore.getState().selectItem((single as HandoutItem).compendiumItemId);
            close();
          }} />
          <HandoutRevealMenu
            handout={single as HandoutItem}
            players={connectedUsers}
            onDone={close}
          />
        </>
      )}

      {single?.type === 'handout' && !isGM && (
        <>
          <div className="gold-divider my-1" />
          <Btn label="📖 View item" onClick={() => {
            useHandoutViewerStore.getState().openHandout(single as HandoutItem);
            close();
          }} />
        </>
      )}

      <div className="gold-divider my-1" />
      <Btn label="🗑 Delete" onClick={del} danger />
    </div>
  );
}

const WEATHER_ICONS: Record<WeatherOverlay, string> = {
  none: '☀',
  rain: '🌧',
  'heavy-rain': '🌧',
  hail: '🧊',
  storm: '⛈',
  snow: '❄',
  blizzard: '🌨',
  fog: '🌫',
  mist: '🌁',
  sandstorm: '🏜',
  swamp: '🐸',
  ash: '🌋',
  embers: '🔥',
  leaves: '🍂',
  fireflies: '✨',
  aurora: '🌌',
};

function MapWeatherMenuSection({ onDone }: { onDone: () => void }) {
  const activeScene = useSceneMediaStore((s) => s.activeScene);
  const sessionWeather = useSceneMediaStore((s) => s.sessionWeather);
  const current = activeScene?.weatherOverlay ?? sessionWeather ?? 'none';

  function pick(weather: WeatherOverlay) {
    const sessionId = getPersistSessionId();
    if (!sessionId) return;
    emitSessionWeather(sessionId, weather);
    onDone();
  }

  return (
    <>
      <div className="gold-divider my-1" />
      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Weather
      </div>
      {WEATHER_PRESETS.map((preset) => {
        const active = (current ?? 'none') === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => pick(preset.id)}
            className="w-full text-left px-3 py-1.5 text-xs font-ui rounded transition-colors"
            style={{
              color: active ? 'var(--color-accent-gold)' : 'var(--color-text-primary)',
              background: active ? 'rgba(201,168,76,0.12)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.background = active ? 'rgba(201,168,76,0.12)' : 'transparent';
            }}
          >
            {WEATHER_ICONS[preset.id]} {preset.label}
            {active ? ' ✓' : ''}
          </button>
        );
      })}
    </>
  );
}

const TIME_ICONS: Record<TimeOfDay, string> = {
  dawn: '🌅',
  day: '☀',
  'golden-hour': '🌇',
  dusk: '🌆',
  night: '🌙',
  midnight: '🌑',
};

function MapTimeMenuSection({ onDone }: { onDone: () => void }) {
  const activeScene = useSceneMediaStore((s) => s.activeScene);
  const sessionTime = useSceneMediaStore((s) => s.sessionTimeOfDay);
  const current = activeScene?.timeOfDay ?? sessionTime ?? 'day';

  function pick(timeOfDay: TimeOfDay) {
    const sessionId = getPersistSessionId();
    if (!sessionId) return;
    emitSessionTimeOfDay(sessionId, timeOfDay);
    onDone();
  }

  return (
    <>
      <div className="gold-divider my-1" />
      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Time of day
      </div>
      {TIME_OF_DAY_PRESETS.map((preset) => {
        const active = current === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => pick(preset.id)}
            className="w-full text-left px-3 py-1.5 text-xs font-ui rounded transition-colors"
            style={{
              color: active ? 'var(--color-accent-gold)' : 'var(--color-text-primary)',
              background: active ? 'rgba(201,168,76,0.12)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget as HTMLElement).style.background = active ? 'rgba(201,168,76,0.12)' : 'transparent';
            }}
          >
            {TIME_ICONS[preset.id]} {preset.label}
            {active ? ' ✓' : ''}
          </button>
        );
      })}
    </>
  );
}

// ─── Token-specific section ─────────────────────────────────────────────────

function findAnyPcDdbCharacterId(): number | null {
  for (const item of Object.values(useItemStore.getState().items)) {
    if (item.type !== 'token') continue;
    const token = item as TokenItem;
    if (token.ddbCharacterId) return token.ddbCharacterId;
  }
  return null;
}

function findPlayerDdbCharacterId(userId: string): number | null {
  for (const item of Object.values(useItemStore.getState().items)) {
    if (item.type !== 'token') continue;
    const token = item as TokenItem;
    if (token.ownerId === userId && token.ddbCharacterId) return token.ddbCharacterId;
  }
  for (const item of Object.values(useItemStore.getState().items)) {
    if (item.type !== 'token') continue;
    const token = item as TokenItem;
    if (token.isPc && token.ddbCharacterId && !token.ownerId) return token.ddbCharacterId;
  }
  return null;
}

function HandoutRevealMenu({
  handout,
  players,
  onDone,
}: {
  handout: HandoutItem;
  players: SessionUser[];
  onDone: () => void;
}) {
  const sessionPlayers = players.filter((p) => p.role === 'PLAYER');
  const [busy, setBusy] = useState(false);
  const partyAnchorId = findAnyPcDdbCharacterId();

  async function give(
    targetUserIds: string[] | 'all',
    push?: { ddbCharacterId: number; target: HandoutInventoryTarget; targetUserId: string },
  ) {
    const sid = getPersistSessionId();
    if (!sid || busy) return;
    setBusy(true);
    try {
      const result = await revealHandoutToPlayers(handout, sid, {
        targetUserIds,
        ...(push ? { pushToDdb: push } : {}),
      });
      const journalCount = result.receipts.length;
      if (result.pushResult) {
        window.alert(
          result.pushResult.ok
            ? `Journal updated (${journalCount}). ${result.pushResult.message}`
            : `Journal updated (${journalCount}), but D&D Beyond sync failed: ${result.pushResult.message}`,
        );
      } else if (journalCount > 0) {
        window.alert(`Item added to ${journalCount} player journal${journalCount === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      window.alert(extractApiError(err, 'Could not give handout'));
    } finally {
      setBusy(false);
      onDone();
    }
  }

  const Btn = ({ label, onClick, indent = false }: { label: string; onClick: () => void; indent?: boolean }) => (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="w-full text-left py-1.5 text-xs font-ui rounded transition-colors disabled:opacity-50"
      style={{
        color: 'var(--color-text-primary)',
        paddingLeft: indent ? '1.5rem' : '0.75rem',
        paddingRight: '0.75rem',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="gold-divider my-1" />
      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Give to players (journal)
      </div>
      <Btn label="✨ All players — journal only" onClick={() => void give('all')} />

      {sessionPlayers.map((player) => (
        <Btn
          key={player.id}
          label={`📜 ${player.username} — journal only`}
          onClick={() => void give([player.id])}
        />
      ))}

      <div className="gold-divider my-1" />
      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Journal + D&D Beyond
      </div>

      <div className="px-3 py-1 font-ui text-[10px] italic" style={{ color: 'var(--color-text-secondary)' }}>
        Party stash uses D&D Beyond&apos;s unofficial API — item may land on the linked character first.
      </div>

      {partyAnchorId ? (
        <Btn
          label="🎒 All players + party inventory"
          onClick={() => void give('all', {
            ddbCharacterId: partyAnchorId,
            target: 'party',
            targetUserId: sessionPlayers[0]?.id ?? useSessionStore.getState().myUserId ?? '',
          })}
        />
      ) : (
        <div className="px-3 py-1 font-ui text-[10px] italic" style={{ color: 'var(--color-text-secondary)' }}>
          Link a PC token to D&D Beyond for party inventory push.
        </div>
      )}

      {sessionPlayers.map((player) => {
        const ddbId = findPlayerDdbCharacterId(player.id);
        if (!ddbId) return null;
        return (
          <div key={`ddb-${player.id}`}>
            <Btn
              label={`⚔ ${player.username} — character sheet`}
              onClick={() => void give([player.id], {
                ddbCharacterId: ddbId,
                target: 'character',
                targetUserId: player.id,
              })}
            />
            {partyAnchorId && (
              <Btn
                label={`🎒 ${player.username} — party inventory`}
                indent
                onClick={() => void give([player.id], {
                  ddbCharacterId: partyAnchorId,
                  target: 'party',
                  targetUserId: player.id,
                })}
              />
            )}
          </div>
        );
      })}

      {partyAnchorId && (
        <>
          <div className="gold-divider my-1" />
          <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            DM direct (journal + D&D Beyond)
          </div>
          <Btn
            label="⚔ My character sheet"
            onClick={() => void give('all', {
              ddbCharacterId: partyAnchorId,
              target: 'character',
              targetUserId: useSessionStore.getState().myUserId ?? '',
            })}
          />
          <Btn
            label="🎒 Party inventory"
            onClick={() => void give('all', {
              ddbCharacterId: partyAnchorId,
              target: 'party',
              targetUserId: useSessionStore.getState().myUserId ?? '',
            })}
          />
        </>
      )}
    </>
  );
}

function TokenOwnerAssign({
  token,
  players,
  onDone,
}: {
  token: TokenItem;
  players: SessionUser[];
  onDone: () => void;
}) {
  const Btn = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-xs font-ui rounded transition-colors"
      style={{
        color: token.ownerId && label.includes(players.find((p) => p.id === token.ownerId)?.username ?? '')
          ? 'var(--color-accent-gold)'
          : 'var(--color-text-primary)',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      {label}
    </button>
  );

  function assign(ownerId: string | null) {
    const patch: Partial<TokenItem> = ownerId
      ? { ownerId, isPc: true }
      : { ownerId: '' };
    useItemStore.getState().updateItem(token.id, patch);
    emitItemUpdate([{ id: token.id, patch }]);
    onDone();
  }

  const sessionPlayers = players.filter((p) => p.role === 'PLAYER');

  return (
    <>
      <div className="gold-divider my-1" />
      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Assign to player
      </div>
      <Btn
        label={token.ownerId?.trim() ? '○ Unassigned' : '● Unassigned'}
        onClick={() => assign(null)}
      />
      {sessionPlayers.map((p) => (
        <Btn
          key={p.id}
          label={token.ownerId?.trim() === p.id ? `● ${p.username}` : `○ ${p.username}`}
          onClick={() => assign(p.id)}
        />
      ))}
      {sessionPlayers.length === 0 && (
        <p className="px-3 py-1 font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          No players online
        </p>
      )}
    </>
  );
}

function TokenExtras({ token }: { token: TokenItem }) {
  const [hoveredCondition, setHoveredCondition] = useState<string | null>(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  function showConditionTip(e: ReactMouseEvent<HTMLButtonElement>, label: string) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const pad = 8;
    const half = 72;
    setHoveredCondition(label);
    setTipPos({
      x: Math.min(Math.max(cx, pad + half), window.innerWidth - pad - half),
      y: rect.top,
    });
  }

  function hideConditionTip() {
    setHoveredCondition(null);
  }

  function update(patch: Partial<TokenItem>) {
    useItemStore.getState().updateItem(token.id, patch);
    emitItemUpdate([{ id: token.id, patch }]);
    if (patch.hp !== undefined || patch.maxHp !== undefined || patch.tempHp !== undefined) {
      applyTokenHpToCombatants(token.id, {
        ...(patch.hp !== undefined ? { hp: patch.hp } : {}),
        ...(patch.maxHp !== undefined ? { maxHp: patch.maxHp } : {}),
        ...(patch.tempHp !== undefined ? { tempHp: patch.tempHp } : {}),
      });
    }
    if (patch.conditions !== undefined) {
      applyTokenConditionsToCombatants(token.id, patch.conditions);
    }
  }
  function toggleCondition(c: string) {
    const has = token.conditions.includes(c);
    const conditions = has ? token.conditions.filter((x) => x !== c) : [...token.conditions, c];
    update({ conditions });
  }

  return (
    <>
      <div className="gold-divider my-1" />
      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>HP</div>
      <div className="px-3 pb-1 flex items-center gap-1">
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => {
          const { hp, tempHp } = applyDamage(token.hp, readTempHp(token.tempHp), 1);
          update({ hp, tempHp });
        }}>−</button>
        <span className="font-ui text-xs flex-1 text-center" style={{ color: 'var(--color-text-primary)' }}>
          {token.hp}/{token.maxHp}
        </span>
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ hp: applyHeal(token.hp, token.maxHp, 1) })}>+</button>
      </div>

      <div className="px-3 py-1 font-ui text-xs" style={{ color: '#60a5fa' }}>Temp HP</div>
      <div className="px-3 pb-1 flex items-center gap-1">
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ tempHp: Math.max(0, readTempHp(token.tempHp) - 1) })}>−</button>
        <span className="font-ui text-xs flex-1 text-center" style={{ color: '#60a5fa' }}>
          {readTempHp(token.tempHp)}
        </span>
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ tempHp: readTempHp(token.tempHp) + 1 })}>+</button>
      </div>

      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>AC</div>
      <div className="px-3 pb-1 flex items-center gap-1">
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ ac: Math.max(0, (token.ac ?? 10) - 1) })}>−</button>
        <span className="font-ui text-xs flex-1 text-center" style={{ color: 'var(--color-text-primary)' }}>{token.ac ?? 10}</span>
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ ac: (token.ac ?? 10) + 1 })}>+</button>
      </div>

      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Vision (ft)</div>
      <div className="px-3 pb-1 flex items-center gap-1">
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ visionRadius: visionRadiusFromFeet(Math.max(1, visionFeet(token) - 5)) })}>−</button>
        <span className="font-ui text-xs flex-1 text-center" style={{ color: 'var(--color-text-primary)' }}>
          {visionFeet(token)}ft
        </span>
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ visionRadius: visionRadiusFromFeet(visionFeet(token) + 5) })}>+</button>
      </div>

      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Aura (cells)</div>
      <div className="px-3 pb-1 flex items-center gap-1">
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ auraRadius: Math.max(0, (token.auraRadius ?? 0) - 1) })}>−</button>
        <span className="font-ui text-xs flex-1 text-center" style={{ color: 'var(--color-text-primary)' }}>{token.auraRadius ?? 0}</span>
        <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => update({ auraRadius: (token.auraRadius ?? 0) + 1, auraColor: token.auraColor ?? '#4169e1' })}>+</button>
      </div>

      <div className="gold-divider my-1" />
      <button
        type="button"
        onClick={() => update({ hideHpFromPlayers: !isHpHiddenFromPlayers(token) })}
        className="w-full text-left px-3 py-1.5 text-xs font-ui rounded transition-colors"
        style={{ color: 'var(--color-text-primary)' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        {isHpHiddenFromPlayers(token) ? '👁 Show HP bar to players' : '🙈 Hide HP bar from players'}
      </button>

      <div className="px-3 py-1 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Conditions</div>
      <div className="px-2 pb-1 flex flex-wrap gap-1">
        {CONDITIONS.map((c) => {
          const on = token.conditions.includes(c);
          return (
            <button key={c} onClick={() => toggleCondition(c)}
              title={c}
              onMouseEnter={(e) => showConditionTip(e, c)}
              onMouseLeave={hideConditionTip}
              className="text-xs px-1.5 py-0.5 rounded font-ui"
              style={{
                background: on ? 'rgba(201,168,76,0.2)' : 'transparent',
                color: on ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                border: `1px solid ${on ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
              }}>
              {c.slice(0, 4)}
            </button>
          );
        })}
      </div>
      {hoveredCondition && (
        <div
          className="pointer-events-none fixed z-[100] whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-ui shadow-panel"
          style={{
            left: tipPos.x,
            top: tipPos.y,
            transform: 'translate(-50%, calc(-100% - 6px))',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
          }}
        >
          {hoveredCondition}
        </div>
      )}
    </>
  );
}
