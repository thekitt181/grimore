import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { v4 as uuidv4 } from 'uuid';
import { DraggablePanel } from '@/components/DraggablePanel';
import { ddbPanelPosition, ddbPanelWidth } from '@/systems/ddb/ddbTokenUtils';
import { isMobileClient } from '@/lib/socket';
import { useInitiativeStore, type Combatant } from '../map/store/initiativeStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { isHpHiddenFromPlayers } from '@/systems/scene/types';
import { useSessionStore } from '@/store/sessionStore';
import {
  applyCombatantHpToToken,
  syncInitiativeToServer,
  applyCombatantConditionsToToken,
} from './initiativeTokenSync';
import { applyDamage, applyHeal, readTempHp } from './hpUtils';
import { rollInitiativeFromTokens } from './rollInitiative';
import { ActiveEffectsPanel } from '@/systems/spells/ActiveEffectsPanel';
import { SpellsWithEffectsPanel } from '@/systems/spells/SpellsWithEffectsPanel';
import { onTokenTookDamageForConcentration } from '@/systems/spells/concentrationManager';

const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated',
  'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained',
  'Stunned', 'Unconscious', 'Exhaustion',
];

function syncToServer() {
  syncInitiativeToServer();
}

export function InitiativeTracker({ onClose }: { onClose: () => void }) {
  const {
    combatants, currentIndex, isActive, round,
    addCombatant, removeCombatant, updateCombatant,
    setInitiative, reorderCombatants, startCombat, endCombat, nextTurn, prevTurn,
  } = useInitiativeStore();
  const tokenPickerOptions = useItemStore(
    useShallow((s) =>
      Object.values(s.items)
        .filter((i): i is TokenItem => i.type === 'token')
        .map((t) => ({ id: t.id, name: t.name })),
    ),
  );
  const tokenCount = useItemStore(
    (s) => Object.values(s.items).filter((i) => i.type === 'token').length,
  );
  const { myRole } = useSessionStore();
  const isGM = myRole === 'GM';

  const [newName, setNewName]   = useState('');
  const [newInit, setNewInit]   = useState(0);
  const [newHp, setNewHp]       = useState(10);
  const [newIsPlayer, setNewIsPlayer] = useState(false);
  const [linkTokenId, setLinkTokenId] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [effectsTab, setEffectsTab] = useState<'active' | 'spells'>('active');

  function handleAdd() {
    if (!newName.trim()) return;
    const linked = linkTokenId
      ? Object.values(useItemStore.getState().items).find(
        (i): i is TokenItem => i.type === 'token' && i.id === linkTokenId,
      )
      : undefined;
    const c: Combatant = {
      id:         uuidv4(),
      name:       newName.trim(),
      initiative: newInit,
      hp:         linked?.hp ?? newHp,
      maxHp:      linked?.maxHp ?? newHp,
      tempHp:     readTempHp(linked?.tempHp),
      conditions: linked ? [...linked.conditions] : [],
      isPlayer:   newIsPlayer,
      hideHpFromPlayers: linked ? isHpHiddenFromPlayers(linked) : false,
      ...(linkTokenId ? { tokenId: linkTokenId } : {}),
    };
    addCombatant(c);
    syncToServer();
    setNewName('');
    setNewInit(0);
  }

  function handleNext() { nextTurn(); syncToServer(); }
  function handlePrev() { prevTurn(); syncToServer(); }
  function handleStart() { startCombat(); syncToServer(); }
  function handleEnd()   { endCombat();  syncToServer(); }

  function handleHpChange(id: string, delta: number) {
    const c = combatants.find((x) => x.id === id);
    if (!c) return;

    if (delta < 0) {
      const { hp, tempHp } = applyDamage(c.hp, c.tempHp, -delta);
      updateCombatant(id, { hp, tempHp });
      applyCombatantHpToToken(c, { hp, tempHp });
      if (c.tokenId) {
        const token = Object.values(useItemStore.getState().items).find(
          (i): i is TokenItem => i.type === 'token' && i.id === c.tokenId,
        );
        if (token) onTokenTookDamageForConcentration(token, -delta, token.ownerId);
      }
    } else {
      const hp = applyHeal(c.hp, c.maxHp, delta);
      updateCombatant(id, { hp });
      applyCombatantHpToToken(c, { hp, tempHp: c.tempHp });
    }
    syncToServer();
  }

  function handleTempHpChange(id: string, delta: number) {
    const c = combatants.find((x) => x.id === id);
    if (!c) return;
    const tempHp = Math.max(0, readTempHp(c.tempHp) + delta);
    updateCombatant(id, { tempHp });
    applyCombatantHpToToken(c, { tempHp });
    syncToServer();
  }

  function toggleCombatantCondition(combatant: Combatant, condition: string) {
    const has = combatant.conditions.includes(condition);
    const conditions = has
      ? combatant.conditions.filter((x) => x !== condition)
      : [...combatant.conditions, condition];
    updateCombatant(combatant.id, { conditions });
    applyCombatantConditionsToToken({ ...combatant, conditions });
    syncToServer();
  }

  const GOLD = 'var(--color-accent-gold)';
  const BD   = 'var(--color-border)';

  return (
    <DraggablePanel
      title="⚔ Initiative"
      subtitle={isActive ? `Round ${round}` : undefined}
      onClose={onClose}
      defaultPosition={ddbPanelPosition(Math.max(16, window.innerWidth - 300), 56)}
      width={ddbPanelWidth(280)}
      maxHeight={isMobileClient() ? 'calc(100vh - 9rem)' : '580px'}
      zIndex={150}
    >
      <div className="select-none">
      {/* Combat controls */}
      {isGM && (
        <div className="flex flex-col gap-1 px-2 py-1.5 shrink-0" style={{ borderBottom: `1px solid ${BD}` }}>
          <div className="flex gap-1">
            {!isActive ? (
              <button onClick={handleStart} className="btn-primary text-xs px-3 py-1 flex-1">
                ▶ Start Combat
              </button>
            ) : (
              <>
                <button onClick={handlePrev} className="btn-ghost text-xs px-2 py-1">◀</button>
                <button onClick={handleNext} className="btn-primary text-xs px-2 py-1 flex-1">Next Turn ▶</button>
                <button onClick={handleEnd} className="btn-ghost text-xs px-2 py-1" style={{ color: '#ef4444' }}>■</button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => { rollInitiativeFromTokens(); }}
            className="btn-ghost text-xs py-1 w-full"
            disabled={tokenCount === 0}
          >
            🎲 Roll Initiative ({tokenCount} token{tokenCount === 1 ? '' : 's'})
          </button>
        </div>
      )}

      {/* Combatant list */}
      <div className="overflow-y-auto flex-1 px-2 py-1 space-y-1">
        {combatants.length === 0 && (
          <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-text-secondary)' }}>
            No combatants. Add tokens below.
          </p>
        )}
        {combatants.map((c, idx) => {
          const isCurrentTurn = isActive && idx === currentIndex;
          const tempHp = readTempHp(c.tempHp);
          const hpPct = c.maxHp > 0 ? Math.max(0, c.hp / c.maxHp) : 0;
          const tempPct = c.maxHp > 0 ? Math.max(0, tempHp / c.maxHp) : 0;
          const hpColor = hpPct > 0.5 ? '#4ade80' : hpPct > 0.25 ? '#facc15' : '#ef4444';

          return (
            <div
              key={c.id}
              draggable={isGM}
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => { if (isGM) e.preventDefault(); }}
              onDrop={() => {
                if (isGM && dragIndex !== null && dragIndex !== idx) {
                  reorderCombatants(dragIndex, idx);
                  syncToServer();
                }
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              className="rounded px-2 py-1.5 transition-all"
              style={{
                background: isCurrentTurn ? 'rgba(201,168,76,0.15)' : 'var(--color-bg-tertiary)',
                border: `1px solid ${isCurrentTurn ? GOLD : BD}`,
                opacity: dragIndex === idx ? 0.55 : 1,
                cursor: isGM ? 'grab' : 'default',
              }}
            >
              <div className="flex items-center gap-1.5">
                {isGM ? (
                  <input
                    type="number"
                    key={`${c.id}-${c.initiative}`}
                    defaultValue={c.initiative}
                    className="w-7 h-7 rounded shrink-0 text-center font-display text-xs font-bold input-dark p-0"
                    style={{ color: isCurrentTurn ? '#0a0a0f' : GOLD, background: isCurrentTurn ? GOLD : 'var(--color-bg-secondary)' }}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isNaN(n)) {
                        setInitiative(c.id, n);
                        syncToServer();
                      }
                    }}
                  />
                ) : (
                  <div
                    className="w-7 h-7 rounded shrink-0 flex items-center justify-center font-display text-xs font-bold"
                    style={{ background: isCurrentTurn ? GOLD : 'var(--color-bg-secondary)', color: isCurrentTurn ? '#0a0a0f' : GOLD }}
                  >
                    {c.initiative}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1">
                    <span className="font-ui text-xs font-semibold truncate" style={{ color: isCurrentTurn ? GOLD : 'var(--color-text-primary)' }}>
                      {c.name}
                    </span>
                    {c.isPlayer && <span className="badge-role-player shrink-0" style={{ fontSize: 8 }}>PC</span>}
                    {isGM && (
                      <button
                        type="button"
                        onClick={() => {
                          const newHideHp = !c.hideHpFromPlayers;
                          updateCombatant(c.id, { hideHpFromPlayers: newHideHp });
                          if (c.tokenId) {
                            // Sync the change to the linked token
                            const token = useItemStore.getState().items[c.tokenId];
                            if (token && token.type === 'token') {
                              useItemStore.getState().updateItem(token.id, { hideHpFromPlayers: newHideHp });
                              emitItemUpdate([{ id: token.id, patch: { hideHpFromPlayers: newHideHp } }]);
                            }
                          }
                          syncToServer();
                        }}
                        className="shrink-0 text-[9px] px-1 rounded"
                        style={{ 
                          color: c.hideHpFromPlayers ? '#ef4444' : '#4ade80',
                          border: `1px solid ${c.hideHpFromPlayers ? '#ef4444' : '#4ade80'}`,
                          background: c.hideHpFromPlayers ? 'rgba(239,68,68,0.1)' : 'rgba(74,222,128,0.1)'
                        }}
                        title={c.hideHpFromPlayers ? "Show HP to players" : "Hide HP from players"}
                      >
                        {c.hideHpFromPlayers ? "HP Hidden" : "HP Visible"}
                      </button>
                    )}
                  </div>
                  {/* HP bar */}
                  {(isGM || !c.hideHpFromPlayers) && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <div className="relative flex-1 h-1 rounded-full overflow-hidden" style={{ background: '#1c1c28' }}>
                        <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${hpPct * 100}%`, background: hpColor }} />
                        {tempHp > 0 && (
                          <div
                            className="absolute inset-y-0 rounded-full transition-all"
                            style={{
                              left: `${hpPct * 100}%`,
                              width: `${Math.min(tempPct * 100, 100 - hpPct * 100)}%`,
                              background: '#60a5fa',
                            }}
                          />
                        )}
                      </div>
                      <span className="font-ui text-xs shrink-0" style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>
                        {c.hp}/{c.maxHp}{tempHp > 0 ? ` +${tempHp}` : ''}
                      </span>
                    </div>
                  )}
                  {isGM && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="font-ui shrink-0" style={{ color: '#60a5fa', fontSize: 8 }}>Temp</span>
                      <button
                        onClick={() => handleTempHpChange(c.id, -1)}
                        className="w-4 h-4 rounded text-xs flex items-center justify-center"
                        style={{ border: '1px solid #60a5fa', color: '#60a5fa', fontSize: 9 }}
                      >−</button>
                      <span className="font-ui text-xs min-w-[1rem] text-center" style={{ color: '#60a5fa', fontSize: 9 }}>
                        {tempHp}
                      </span>
                      <button
                        onClick={() => handleTempHpChange(c.id, 1)}
                        className="w-4 h-4 rounded text-xs flex items-center justify-center"
                        style={{ border: '1px solid #60a5fa', color: '#60a5fa', fontSize: 9 }}
                      >+</button>
                    </div>
                  )}
                  {(c.conditions.length > 0 || isGM) && (
                    <div className="flex flex-wrap gap-0.5 mt-1">
                      {isGM
                        ? CONDITIONS.map((cond) => {
                            const on = c.conditions.includes(cond);
                            return (
                              <button
                                key={cond}
                                type="button"
                                title={cond}
                                onClick={() => toggleCombatantCondition(c, cond)}
                                className="font-ui rounded px-1 py-0"
                                style={{
                                  fontSize: 7,
                                  background: on ? 'rgba(201,168,76,0.2)' : 'transparent',
                                  color: on ? GOLD : 'var(--color-text-secondary)',
                                  border: `1px solid ${on ? GOLD : BD}`,
                                }}
                              >
                                {cond.slice(0, 3)}
                              </button>
                            );
                          })
                        : c.conditions.map((cond) => (
                            <span
                              key={cond}
                              className="font-ui rounded px-1 py-0"
                              style={{
                                fontSize: 7,
                                background: 'rgba(201,168,76,0.15)',
                                color: GOLD,
                                border: `1px solid ${GOLD}`,
                              }}
                              title={cond}
                            >
                              {cond.slice(0, 3)}
                            </span>
                          ))}
                    </div>
                  )}
                </div>

                {/* HP controls */}
                {isGM && (
                  <div className="flex gap-0.5 shrink-0">
                    <button
                      onClick={() => handleHpChange(c.id, -1)}
                      className="w-5 h-5 rounded text-xs flex items-center justify-center"
                      style={{ border: '1px solid #ef4444', color: '#ef4444' }}
                    >−</button>
                    <button
                      onClick={() => handleHpChange(c.id, 1)}
                      className="w-5 h-5 rounded text-xs flex items-center justify-center"
                      style={{ border: '1px solid #4ade80', color: '#4ade80' }}
                    >+</button>
                    <button
                      onClick={() => { removeCombatant(c.id); syncToServer(); }}
                      className="w-5 h-5 rounded text-xs flex items-center justify-center opacity-40 hover:opacity-100"
                      style={{ color: 'var(--color-accent-red-hot)' }}
                    >✕</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-2 py-2 shrink-0" style={{ borderTop: `1px solid ${BD}` }}>
        <div className="flex gap-1 mb-2">
          <button
            type="button"
            onClick={() => setEffectsTab('active')}
            className="font-ui text-[9px] flex-1 py-1 rounded"
            style={{
              background: effectsTab === 'active' ? 'rgba(201,168,76,0.15)' : 'transparent',
              border: `1px solid ${effectsTab === 'active' ? GOLD : BD}`,
              color: effectsTab === 'active' ? GOLD : 'var(--color-text-secondary)',
            }}
          >
            Active effects
          </button>
          <button
            type="button"
            onClick={() => setEffectsTab('spells')}
            className="font-ui text-[9px] flex-1 py-1 rounded"
            style={{
              background: effectsTab === 'spells' ? 'rgba(201,168,76,0.15)' : 'transparent',
              border: `1px solid ${effectsTab === 'spells' ? GOLD : BD}`,
              color: effectsTab === 'spells' ? GOLD : 'var(--color-text-secondary)',
            }}
          >
            Spell VFX (47)
          </button>
        </div>
        {effectsTab === 'active' ? <ActiveEffectsPanel /> : <SpellsWithEffectsPanel />}
      </div>

      {/* Add combatant form (GM only) */}
      {isGM && (
        <div className="px-2 py-2 shrink-0 space-y-1.5" style={{ borderTop: `1px solid ${BD}` }}>
          <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Add Combatant</p>
          <input
            className="input-dark text-xs py-0.5 w-full"
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="flex gap-1">
            <div className="flex-1">
              <label className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>Initiative</label>
              <input
                type="number"
                className="input-dark text-xs py-0.5 w-full"
                value={newInit}
                onChange={(e) => setNewInit(Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>HP</label>
              <input
                type="number"
                className="input-dark text-xs py-0.5 w-full"
                value={newHp}
                onChange={(e) => setNewHp(Number(e.target.value))}
              />
            </div>
          </div>
          {/* Link to token */}
          {tokenPickerOptions.length > 0 && (
            <select
              value={linkTokenId}
              onChange={(e) => {
                setLinkTokenId(e.target.value);
                if (e.target.value) {
                  const t = Object.values(useItemStore.getState().items).find(
                    (i): i is TokenItem => i.type === 'token' && i.id === e.target.value,
                  );
                  if (t) {
                    if (!newName) setNewName(t.name);
                    setNewHp(t.hp);
                  }
                }
              }}
              className="input-dark text-xs py-0.5 w-full"
            >
              <option value="">— Link to token (optional) —</option>
              {tokenPickerOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-player"
              checked={newIsPlayer}
              onChange={(e) => setNewIsPlayer(e.target.checked)}
              className="accent-[#c9a84c]"
            />
            <label htmlFor="is-player" className="font-ui text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
              Player Character
            </label>
          </div>
          <button onClick={handleAdd} className="btn-primary w-full text-xs py-1">+ Add</button>
        </div>
      )}
      </div>
    </DraggablePanel>
  );
}
