import { useState } from 'react';
import { useItemStore } from './store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { emitItemUpdate } from './sceneSync';
import { syncGridToMap } from './syncGridToMap';
import type { ImageItem, Item, MapItem, TokenItem, TextItem, DrawItem } from './types';
import { isHpHiddenFromPlayers } from './types';
import { visionFeet, visionRadiusFromFeet } from '@/systems/map/fogLos';
import { VisionFtInput } from '@/systems/map/VisionFtInput';
import { applyTokenHpToCombatants } from '@/systems/initiative/initiativeTokenSync';
import { applyDamage, applyHeal, readTempHp } from '@/systems/initiative/hpUtils';
import { deleteCurrentSelection } from './deleteSelection';
import { playerCanRotateToken } from './token/clientTokenVisibility';
import { useTokenStore } from './store/tokenStore';
import {
  armPropForDdbRoll,
  canTriggerProp,
  propActivateCheckLabel,
  propNextCheckKind,
  propRevealCheckLabel,
  resolvePropId,
  tokenNearProp,
  triggerDungeonPropAsync,
  triggerablePropUnderToken,
  triggerPropUnderToken,
} from '@/systems/map/props/dungeonProps';
import { PropCheckSelect } from '@/systems/map/props/PropCheckSelect';
import { resolveTokenModelUrl } from '@/systems/map3d/defaultTokenModel';

function numHex(n: number): string { return '#' + n.toString(16).padStart(6, '0'); }
function hexNum(s: string): number { return parseInt(s.replace('#', ''), 16); }

export function ItemInspector() {
  const selectedIds = useItemStore((s) => s.selectedIds);
  const selectedWallIndices = useItemStore((s) => s.selectedWallIndices);
  const items = useItemStore((s) => s.items);
  const myRole = useSessionStore((s) => s.myRole);
  const isGM = myRole === 'GM';

  const selected = selectedIds.map((id) => items[id]).filter(Boolean) as Item[];
  if (!isGM || (selected.length === 0 && selectedWallIndices.length === 0)) return null;

  function update(id: string, patch: Partial<Item>) {
    useItemStore.getState().updateItem(id, patch);
    emitItemUpdate([{ id, patch }]);
  }
  function patchAll(patch: Partial<Item>) {
    const updates = selected.map((i) => ({ id: i.id, patch }));
    useItemStore.getState().updateItems(updates);
    emitItemUpdate(updates);
  }
  function del() {
    deleteCurrentSelection();
  }

  const single = selected.length === 1 ? selected[0]! : null;
  const allLocked = selected.every((i) => i.locked);
  const allHidden = selected.every((i) => !i.visible);

  return (
    <div
      className="rounded-lg shadow-panel px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 max-w-full overflow-x-auto"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-gold)' }}
    >
      <span className="font-display text-xs tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>
        {selectedWallIndices.length > 0 && selected.length === 0
          ? `${selectedWallIndices.length} walls`
          : selectedWallIndices.length > 0 && selected.length > 0
            ? `${selected.length} items · ${selectedWallIndices.length} walls`
            : single
              ? (single.type === 'handout' ? 'handout' : single.type)
              : `${selected.length} items`}
      </span>

      {/* Type-specific */}
      {single?.type === 'map' && isGM && <MapControls map={single as MapItem} update={(p) => update(single.id, p)} />}
      {single?.type === 'token' && (
        <TokenControls
          token={single as TokenItem}
          isGM={isGM}
          update={(p) => {
            update(single.id, p);
            if (p.hp !== undefined || p.maxHp !== undefined || p.tempHp !== undefined) {
              applyTokenHpToCombatants(single.id, {
                ...(p.hp !== undefined ? { hp: p.hp } : {}),
                ...(p.maxHp !== undefined ? { maxHp: p.maxHp } : {}),
                ...(p.tempHp !== undefined ? { tempHp: p.tempHp } : {}),
              });
            }
          }}
        />
      )}
      {single?.type === 'token' && isGM && <TokenPropUnderControls token={single as TokenItem} />}
      {single?.type === 'image' && isGM && (
        <PropControls image={single as ImageItem} update={(p) => update(single.id, p)} />
      )}
      {single?.type === 'text' && <TextControls t={single as TextItem} update={(p) => update(single.id, p)} />}
      {single?.type === 'drawing' && <DrawControls d={single as DrawItem} update={(p) => update(single.id, p)} />}

      {(single || selected.length > 1) && (
        <div className="w-px h-6" style={{ background: 'var(--color-border)' }} />
      )}

      {/* Common actions */}
      {selected.length > 0 && (
        <>
          <button title="Lock" className="text-sm px-1.5 py-0.5 rounded transition-colors"
            style={{ color: allLocked ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)' }}
            onClick={() => patchAll({ locked: !allLocked } as Partial<Item>)}>
            {allLocked ? '🔒' : '🔓'}
          </button>
          {isGM && (
            <button title="Hide from players" className="text-sm px-1.5 py-0.5 rounded transition-colors"
              style={{ color: allHidden ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)' }}
              onClick={() => patchAll({ visible: allHidden } as Partial<Item>)}>
              {allHidden ? '🙈' : '👁'}
            </button>
          )}
        </>
      )}
      <button title="Delete (Del)" className="text-sm px-1.5 py-0.5 rounded" style={{ color: 'var(--color-accent-red-hot)' }} onClick={del}>🗑</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1">
      <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

function MapControls({ map, update }: { map: MapItem; update: (p: Partial<MapItem>) => void }) {
  const [syncing, setSyncing] = useState(false);

  function handleAutoSync() {
    setSyncing(true);
    const result = syncGridToMap(map);
    setSyncing(false);
    if (!result.ok) {
      alert('Select a map first.');
    }
  }

  return (
    <>
      <button
        title="Fit an even 5ft grid to the map"
        className="btn-primary text-xs px-2 py-0.5"
        disabled={syncing}
        onClick={() => handleAutoSync()}
      >
        {syncing ? '…' : '⊹ Fit grid'}
      </button>
      <Field label="Grid">
        <input type="color" value={numHex(map.gridColor)} onChange={(e) => update({ gridColor: hexNum(e.target.value) })}
          className="w-6 h-6 rounded cursor-pointer border-0 p-0" />
      </Field>
      <Field label="Op">
        <input type="range" min={0} max={1} step={0.1} value={map.gridOpacity}
          onChange={(e) => update({ gridOpacity: Number(e.target.value) })} className="w-16 accent-[#c9a84c]" />
      </Field>
    </>
  );
}

function TokenControls({
  token,
  isGM,
  update,
}: {
  token: TokenItem;
  isGM: boolean;
  update: (p: Partial<TokenItem>) => void;
}) {
  const myUserId = useSessionStore((s) => s.myUserId);
  const resetTokenRotation = useTokenStore((s) => s.resetTokenRotation);
  const isMonster = Boolean(token.monsterId);
  const canRotate = playerCanRotateToken(token, myUserId);
  const showResetRotation = (isGM || canRotate) && !token.locked;
  const modelUrl = resolveTokenModelUrl(token);

  if (!isGM && isMonster) {
    return (
      <Field label="Name">
        <span className="font-ui text-xs" style={{ color: 'var(--color-text-primary)' }}>{token.name}</span>
      </Field>
    );
  }

  const ac = token.ac ?? 10;
  const visionFt = visionFeet(token);
  const tempHp = readTempHp(token.tempHp);
  return (
    <>
      <Field label="Name">
        <input
          className="input-dark text-xs py-0.5 w-32"
          value={token.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </Field>
      <Field label="HP">
        <input type="number" className="input-stat" min={0} value={token.hp}
          onChange={(e) => update({ hp: Math.max(0, Number(e.target.value)) })} />
        <span className="font-ui text-xs px-0.5" style={{ color: 'var(--color-text-secondary)' }}>/</span>
        <input type="number" className="input-stat" min={1} value={token.maxHp}
          onChange={(e) => update({ maxHp: Math.max(1, Number(e.target.value)) })} />
      </Field>
      <Field label="Temp">
        <input type="number" className="input-stat" min={0} value={tempHp}
          onChange={(e) => update({ tempHp: Math.max(0, Number(e.target.value)) })} />
      </Field>
      <Field label="AC">
        <input type="number" className="input-stat" min={0} value={ac}
          onChange={(e) => update({ ac: Math.max(0, Number(e.target.value)) })} />
      </Field>
      <Field label="Vision (ft)">
        <VisionFtInput
          valueFt={visionFt}
          onChangeFt={(ft) => update({ visionRadius: visionRadiusFromFeet(ft) })}
        />
      </Field>
      {token.ddbCharacterId && (
        <Field label="DDB">
          <button
            type="button"
            className="btn-ghost text-xs px-2 py-0.5 whitespace-nowrap"
            onClick={() => update({ syncHpToDdb: !token.syncHpToDdb })}
          >
            {token.syncHpToDdb ? 'HP → DDB on' : 'HP → DDB off'}
          </button>
        </Field>
      )}
      {isGM && (
        <Field label="HP bar">
          <button
            type="button"
            className="btn-ghost text-xs px-2 py-0.5 whitespace-nowrap"
            onClick={() => update({ hideHpFromPlayers: !isHpHiddenFromPlayers(token) })}
          >
            {isHpHiddenFromPlayers(token) ? 'Hidden from players' : 'Visible to players'}
          </button>
        </Field>
      )}
      {showResetRotation && (
        <Field label="Rotate">
          <button
            type="button"
            className="btn-ghost text-xs px-2 py-0.5 whitespace-nowrap"
            title={token.modelUrl ? 'Reset facing to 0° and default mini view angle' : 'Reset facing to 0°'}
            onClick={() => resetTokenRotation(token.id)}
          >
            Reset rotation
          </button>
        </Field>
      )}
    </>
  );
}

function TextControls({ t, update }: { t: TextItem; update: (p: Partial<TextItem>) => void }) {
  return (
    <>
      <Field label="Text">
        <input className="input-dark text-xs py-0.5 w-32" value={t.text} onChange={(e) => update({ text: e.target.value })} />
      </Field>
      <Field label="Size">
        <input type="number" className="input-dark text-xs py-0.5 w-12" value={t.fontSize} onChange={(e) => update({ fontSize: Math.max(6, Number(e.target.value)) })} />
      </Field>
      <Field label="Col">
        <input type="color" value={t.color} onChange={(e) => update({ color: e.target.value })} className="w-6 h-6 rounded cursor-pointer border-0 p-0" />
      </Field>
    </>
  );
}

function DrawControls({ d, update }: { d: DrawItem; update: (p: Partial<DrawItem>) => void }) {
  return (
    <>
      <Field label="Stroke">
        <input type="number" className="input-dark text-xs py-0.5 w-12" value={d.stroke} onChange={(e) => update({ stroke: Math.max(1, Number(e.target.value)) })} />
      </Field>
      <Field label="Col">
        <input type="color" value={d.color} onChange={(e) => update({ color: e.target.value })} className="w-6 h-6 rounded cursor-pointer border-0 p-0" />
      </Field>
    </>
  );
}

function PropControls({
  image,
  update,
}: {
  image: ImageItem;
  update: (p: Partial<ImageItem>) => void;
}) {
  const propId = resolvePropId(image);
  if (!propId || !canTriggerProp(propId)) return null;

  const revealDc = image.propRevealDc ?? 0;
  const revealCheck = image.propRevealCheck ?? '';
  const revealNotation = image.propRevealNotation ?? '1d20';
  const activateDc = image.propActivateDc ?? 0;
  const activateCheck = image.propActivateCheck ?? '';
  const activateNotation = image.propActivateNotation ?? '1d20';
  const next = propNextCheckKind(image);
  const nextLabel =
    next === 'reveal'
      ? propRevealCheckLabel(image)
      : next === 'activate'
        ? propActivateCheckLabel(image)
        : undefined;
  const nextDc = next === 'reveal' ? revealDc : next === 'activate' ? activateDc : 0;
  const actor = tokenNearProp(image);
  const canArmDdb =
    Boolean(next)
    && Boolean(next === 'reveal' ? revealCheck : activateCheck)
    && Boolean(actor);

  return (
    <>
      <button
        type="button"
        title={
          next
            ? `Roll ${nextLabel ?? 'check'} to ${next} (DC ${nextDc})`
            : 'Open / close / fire this prop'
        }
        className="btn-primary text-xs px-2 py-0.5 whitespace-nowrap"
        onClick={() => void triggerDungeonPropAsync(image, { actor })}
      >
        {next === 'reveal'
          ? `👁 Reveal DC ${revealDc}`
          : next === 'activate'
            ? `🎲 Open DC ${activateDc}`
            : image.visible === false
              ? '👁 Reveal'
              : '🗝 Use'}
      </button>
      {canArmDdb && (
        <button
          type="button"
          title={`Wait for ${nextLabel} on D&D Beyond (${next})`}
          className="btn-ghost text-xs px-2 py-0.5 whitespace-nowrap"
          onClick={() => armPropForDdbRoll(image, actor)}
        >
          ⏳ DDB
        </button>
      )}

      <span className="font-ui text-[10px] uppercase tracking-wide px-1" style={{ color: 'var(--color-accent-gold)' }}>
        Reveal
      </span>
      <Field label="Check">
        <PropCheckSelect
          value={revealCheck}
          title="Search check to reveal a hidden prop (e.g. Perception)"
          onChange={(v) => update(v ? { propRevealCheck: v } : { propRevealCheck: '' })}
        />
      </Field>
      <Field label="DC">
        <input
          type="number"
          className="input-stat"
          min={0}
          title="0 = no search roll. Hidden props stay GM-only until this check succeeds."
          value={revealDc}
          onChange={(e) => update({ propRevealDc: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Field>
      {!revealCheck && revealDc > 0 && (
        <Field label="Dice">
          <input
            className="input-dark text-xs py-0.5 w-16"
            value={revealNotation}
            onChange={(e) => update({ propRevealNotation: e.target.value.trim() || '1d20' })}
          />
        </Field>
      )}

      <span className="font-ui text-[10px] uppercase tracking-wide px-1" style={{ color: 'var(--color-accent-gold)' }}>
        Open
      </span>
      <Field label="Check">
        <PropCheckSelect
          value={activateCheck}
          title="Check to open / fire (e.g. Athletics, Strength)"
          onChange={(v) => update(v ? { propActivateCheck: v } : { propActivateCheck: '' })}
        />
      </Field>
      <Field label="DC">
        <input
          type="number"
          className="input-stat"
          min={0}
          title="0 = free to open once revealed. Closing skips the roll."
          value={activateDc}
          onChange={(e) => update({ propActivateDc: Math.max(0, Number(e.target.value) || 0) })}
        />
      </Field>
      {!activateCheck && activateDc > 0 && (
        <Field label="Dice">
          <input
            className="input-dark text-xs py-0.5 w-16"
            value={activateNotation}
            onChange={(e) => update({ propActivateNotation: e.target.value.trim() || '1d20' })}
          />
        </Field>
      )}
    </>
  );
}

function TokenPropUnderControls({ token }: { token: TokenItem }) {
  const prop = triggerablePropUnderToken(token, true);
  if (!prop) return null;
  const next = propNextCheckKind(prop);
  const checkLabel =
    next === 'reveal' ? propRevealCheckLabel(prop) : propActivateCheckLabel(prop);
  const dc =
    next === 'reveal' ? prop.propRevealDc : next === 'activate' ? prop.propActivateDc : 0;
  const linked =
    next === 'reveal' ? prop.propRevealCheck : next === 'activate' ? prop.propActivateCheck : undefined;
  return (
    <>
      <button
        type="button"
        title={
          next
            ? `Roll ${checkLabel ?? 'check'} to ${next} ${prop.name}`
            : `Use ${prop.name} under this token`
        }
        className="btn-primary text-xs px-2 py-0.5 whitespace-nowrap"
        onClick={() => void triggerPropUnderToken(token)}
      >
        {next === 'reveal'
          ? `👁 Reveal DC ${dc}`
          : next === 'activate'
            ? `🎲 Open DC ${dc}`
            : prop.visible === false
              ? `👁 Reveal ${prop.name}`
              : `🗝 ${prop.name}`}
      </button>
      {next && linked && (
        <button
          type="button"
          title={`Wait for ${checkLabel} on D&D Beyond`}
          className="btn-ghost text-xs px-2 py-0.5 whitespace-nowrap"
          onClick={() => void triggerPropUnderToken(token, { waitForDdb: true })}
        >
          ⏳ DDB
        </button>
      )}
    </>
  );
}
