import { useState } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useTokenStore } from '@/systems/scene/store/tokenStore';
import { useSessionStore } from '@/store/sessionStore';
import type { TokenItem } from '@/systems/scene/types';
import { getTokenRenderType } from '@/systems/scene/token/tokenRenderType';
import { worldToGridColRow } from '@/systems/scene/token/tokenGrid';
import {
  emitTokenHp,
  emitTokenHide,
  emitTokenDelete,
  emitTokenCondition,
} from '@/systems/scene/token/tokenSync';
import { applyTokenHpToCombatants } from '@/systems/initiative/initiativeTokenSync';
import { isHpHiddenFromPlayers } from '@/systems/scene/types';

const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled',
  'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone',
  'Restrained', 'Stunned', 'Unconscious',
];

export function TokenPropertiesPanel() {
  const selectedIds = useItemStore((s) => s.selectedIds);
  const items = useItemStore((s) => s.items);
  const myRole = useSessionStore((s) => s.myRole);
  const moveModeTokenId = useTokenStore((s) => s.moveModeTokenId);
  const toggleMoveMode = useTokenStore((s) => s.toggleMoveMode);
  const setTokenRenderType = useTokenStore((s) => s.setTokenRenderType);
  const rotateToken = useTokenStore((s) => s.rotateToken);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isGM = myRole === 'GM';
  if (selectedIds.length !== 1) return null;
  const item = items[selectedIds[0]!];
  if (!item || item.type !== 'token') return null;
  const token = item as TokenItem;
  const renderType = getTokenRenderType(token);
  const { gridCol, gridRow } = token.gridCol != null && token.gridRow != null
    ? { gridCol: token.gridCol, gridRow: token.gridRow }
    : worldToGridColRow(token.x + token.width / 2, token.y + token.height / 2);
  const inMoveMode = moveModeTokenId === token.id;

  function patch(p: Partial<TokenItem>) {
    if (p.hp !== undefined || p.maxHp !== undefined) {
      const hp = p.hp ?? token.hp;
      const maxHp = p.maxHp ?? token.maxHp;
      useItemStore.getState().updateItem(token.id, { hp, maxHp });
      emitTokenHp(token.id, hp, maxHp);
      applyTokenHpToCombatants(token.id, {
        ...(p.hp !== undefined ? { hp: p.hp } : {}),
        ...(p.maxHp !== undefined ? { maxHp: p.maxHp } : {}),
      });
      return;
    }
    if (p.conditions) {
      useItemStore.getState().updateItem(token.id, { conditions: p.conditions });
      emitTokenCondition(token.id, p.conditions);
      return;
    }
    if (p.visible !== undefined) {
      useItemStore.getState().updateItem(token.id, { visible: p.visible });
      emitTokenHide(token.id, !p.visible);
      return;
    }
    useItemStore.getState().updateItem(token.id, p);
  }

  return (
    <div
      className="absolute top-24 right-4 z-40 w-72 max-h-[calc(100%-7rem)] overflow-y-auto rounded-lg shadow-panel p-4 flex flex-col gap-3"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-gold)' }}
    >
      <h3 className="font-display text-sm tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>
        Token
      </h3>

      {token.imageUrl && (
        <img
          src={token.imageUrl}
          alt={token.name}
          className="w-20 h-20 rounded-full object-cover mx-auto border-2"
          style={{ borderColor: token.borderColour ?? '#c9a84c' }}
        />
      )}

      <label className="flex flex-col gap-1">
        <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Name</span>
        <input
          className="input-dark text-sm"
          value={token.name}
          disabled={!isGM}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>

      {isGM && (
        <div className="flex gap-2">
          <button
            type="button"
            className={`flex-1 text-xs py-1.5 rounded ${renderType === '2d' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTokenRenderType(token.id, '2d')}
          >
            2D
          </button>
          <button
            type="button"
            className={`flex-1 text-xs py-1.5 rounded ${renderType === '3d' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTokenRenderType(token.id, '3d')}
          >
            3D
          </button>
        </div>
      )}

      <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Grid: {gridCol}, {gridRow}
      </p>

      {(isGM || !isHpHiddenFromPlayers(token)) && (
        <div className="flex gap-2">
          <label className="flex-1 flex flex-col gap-1">
            <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>HP</span>
            <input
              type="number"
              className="input-dark text-sm"
              value={token.hp}
              disabled={!isGM}
              onChange={(e) => patch({ hp: Number(e.target.value) })}
            />
          </label>
          <label className="flex-1 flex flex-col gap-1">
            <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Max</span>
            <input
              type="number"
              className="input-dark text-sm"
              value={token.maxHp}
              disabled={!isGM}
              onChange={(e) => patch({ maxHp: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      {isGM && (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Border colour</span>
            <input
              type="color"
              value={token.borderColour ?? '#c9a84c'}
              onChange={(e) => patch({ borderColour: e.target.value })}
              className="w-full h-8 rounded cursor-pointer border-0 p-0"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Conditions</span>
            <select
              className="input-dark text-sm"
              value=""
              onChange={(e) => {
                const c = e.target.value;
                if (!c || token.conditions.includes(c)) return;
                patch({ conditions: [...token.conditions, c] });
              }}
            >
              <option value="">Add condition…</option>
              {CONDITIONS.filter((c) => !token.conditions.includes(c)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1 mt-1">
              {token.conditions.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}
                  onClick={() => patch({ conditions: token.conditions.filter((x) => x !== c) })}
                >
                  {c} ×
                </button>
              ))}
            </div>
          </label>

          <button
            type="button"
            className={`w-full py-2 rounded text-sm ${inMoveMode ? 'btn-primary' : 'btn-ghost border border-[var(--color-border-gold)]'}`}
            onClick={() => toggleMoveMode(token.id)}
          >
            {inMoveMode ? 'Exit Move Mode' : 'Move'}
          </button>

          <div className="flex gap-2">
            <button type="button" className="flex-1 btn-ghost text-sm py-1.5" onClick={() => rotateToken(token.id, -45)}>
              ↺ 45°
            </button>
            <button type="button" className="flex-1 btn-ghost text-sm py-1.5" onClick={() => rotateToken(token.id, 45)}>
              ↻ 45°
            </button>
          </div>

          <button
            type="button"
            className="w-full btn-ghost text-sm py-1.5"
            onClick={() => patch({ visible: !token.visible })}
          >
            {token.visible ? 'Hide from players' : 'Show to players'}
          </button>

          {!confirmDelete ? (
            <button
              type="button"
              className="w-full text-sm py-1.5 rounded"
              style={{ color: 'var(--color-accent-red-hot)' }}
              onClick={() => setConfirmDelete(true)}
            >
              Delete token
            </button>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="flex-1 btn-ghost text-sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 text-sm py-1.5 rounded"
                style={{ background: 'var(--color-accent-red-hot)', color: '#fff' }}
                onClick={() => {
                  emitTokenDelete(token.id);
                  useItemStore.getState().select([], 'set');
                  setConfirmDelete(false);
                }}
              >
                Confirm
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
