import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import {
  DAMAGE_MULTIPLIERS,
  MULTIPLIER_LABELS,
  type DamageMultiplier,
} from './damageMultiplier';
import {
  computeFinalDamage,
  DEFENSE_BADGE,
  formatFinalDamage,
  getCachedTokenDefenses,
  getDefenseAdjustment,
  parseDamageTypeFromLabel,
  resolveDamageType,
} from './damageDefense';
import { fetchDdbCharacter } from '@/systems/ddb/ddbApi';
import { getMonster } from '@/systems/compendium/compendiumApi';
import { formatAoeLabel } from '@/systems/compendium/statBlockParser';
import { applyDamageToToken } from './applyTokenDamage';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export interface DamageAssignment {
  tokenId: string;
  tokenName: string;
  multiplier: DamageMultiplier;
}

export interface PendingDamageApply {
  actionName: string;
  damageLabel: string;
  /** e.g. fire, cold, slashing — used for resistance / immunity checks. */
  damageType?: string;
  baseTotal: number;
  notation: string;
  assignments: DamageAssignment[];
  /** Save-for-half area effect (breath weapon, fireball, etc.). */
  isSaveEffect?: boolean;
  saveDc?: number;
  saveStat?: string;
  aoe?: { size: number; type: string };
  sourceTokenId?: string;
}

function MultiplierPicker({
  value,
  onChange,
}: {
  value: DamageMultiplier;
  onChange: (m: DamageMultiplier) => void;
}) {
  return (
    <div className="flex gap-0.5 shrink-0">
      {DAMAGE_MULTIPLIERS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className="font-ui text-[10px] px-1.5 py-0.5 rounded transition-all"
          style={{
            background: value === m ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-primary)',
            border: `1px solid ${value === m ? GOLD : BD}`,
            color: value === m ? GOLD : 'var(--color-text-secondary)',
          }}
        >
          {MULTIPLIER_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

export function DamageApplyPanel({
  pending,
  onApplied,
  onCancel,
}: {
  pending: PendingDamageApply;
  onApplied: () => void;
  onCancel: () => void;
}) {
  const [assignments, setAssignments] = useState<DamageAssignment[]>(pending.assignments);
  const [showAdd, setShowAdd] = useState(false);

  const tokens = useItemStore((s) =>
    Object.values(s.items).filter((i): i is TokenItem => i.type === 'token'),
  );

  const assignedIds = useMemo(() => new Set(assignments.map((a) => a.tokenId)), [assignments]);
  const addable = tokens.filter((t) => !assignedIds.has(t.id));
  const damageType = resolveDamageType(pending.damageType, pending.damageLabel, pending.actionName);

  const assignedTokens = useMemo(
    () =>
      assignments
        .map((row) => tokens.find((t) => t.id === row.tokenId))
        .filter((t): t is TokenItem => Boolean(t)),
    [assignments, tokens],
  );

  const ddbIds = useMemo(
    () => [...new Set(tokens.map((t) => t.ddbCharacterId).filter((id): id is number => Boolean(id)))],
    [tokens],
  );
  const monsterIds = useMemo(
    () => [...new Set(assignedTokens.map((t) => t.monsterId).filter((id): id is string => Boolean(id)))],
    [assignedTokens],
  );

  useQueries({
    queries: [
      ...ddbIds.map((id) => ({
        queryKey: ['ddb', 'character', id] as const,
        queryFn: () => fetchDdbCharacter(id),
        staleTime: 30_000,
      })),
      ...monsterIds.map((id) => ({
        queryKey: ['compendium', 'monster', id] as const,
        queryFn: () => getMonster(id),
        staleTime: 120_000,
      })),
    ],
  });

  function defenseForToken(tokenId: string) {
    const token = tokens.find((t) => t.id === tokenId);
    if (!token || !damageType) return null;
    return getDefenseAdjustment(getCachedTokenDefenses(token), damageType);
  }

  function finalDamageForRow(row: DamageAssignment): number {
    return computeFinalDamage(pending.baseTotal, row.multiplier, defenseForToken(row.tokenId));
  }

  function applyAll() {
    for (const row of assignments) {
      const amount = finalDamageForRow(row);
      if (amount > 0) applyDamageToToken(row.tokenId, amount);
    }
    onApplied();
  }

  function setMultiplier(tokenId: string, multiplier: DamageMultiplier) {
    setAssignments((rows) => rows.map((r) => (r.tokenId === tokenId ? { ...r, multiplier } : r)));
  }

  function removeRow(tokenId: string) {
    setAssignments((rows) => rows.filter((r) => r.tokenId !== tokenId));
  }

  function addTarget(token: TokenItem, multiplier: DamageMultiplier = 'normal') {
    setAssignments((rows) => [...rows, { tokenId: token.id, tokenName: token.name, multiplier }]);
    setShowAdd(false);
  }

  const isMulti = assignments.length > 1;

  return (
    <div
      className="mt-2 pt-2 space-y-2"
      style={{ borderTop: `1px solid ${BD}` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
            {pending.isSaveEffect ? 'Save effect' : 'Rolled'} · {pending.damageLabel}
          </p>
          <p className="font-display text-lg font-bold" style={{ color: '#fca5a5' }}>
            {pending.baseTotal}
            {pending.isSaveEffect && (
              <span className="font-ui text-[10px] font-normal ml-1 opacity-70">(failed save)</span>
            )}
          </p>
          {pending.isSaveEffect && pending.saveDc !== undefined && (
            <p className="font-ui text-[9px] mt-0.5" style={{ color: '#fca5a5' }}>
              DC {pending.saveDc} {pending.saveStat} save
            </p>
          )}
          {pending.aoe && (
            <p className="font-ui text-[9px] mt-0.5" style={{ color: GOLD }}>
              Area: {formatAoeLabel(pending.aoe)}
            </p>
          )}
        </div>
        <button type="button" onClick={onCancel} className="text-[10px] opacity-40 hover:opacity-100" style={{ color: 'var(--color-text-secondary)' }}>✕</button>
      </div>

      <p className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
        {pending.isSaveEffect
          ? 'Add each creature in the area — 1× failed save, ½ succeeded (or pick manually):'
          : isMulti
            ? 'Assign damage per target:'
            : 'Apply damage:'}
      </p>

      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {assignments.map((row) => {
          const adjustment = defenseForToken(row.tokenId);
          return (
          <div
            key={row.tokenId}
            className="rounded px-2 py-1.5 flex flex-col gap-1"
            style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-ui text-xs font-semibold truncate">{row.tokenName}</span>
              <span className="font-ui text-xs shrink-0 flex items-center gap-1" style={{ color: '#fca5a5' }}>
                {formatFinalDamage(pending.baseTotal, row.multiplier, adjustment)}
                {adjustment && (
                  <span
                    className="text-[9px] px-1 rounded"
                    style={{
                      color: DEFENSE_BADGE[adjustment].color,
                      border: `1px solid ${DEFENSE_BADGE[adjustment].color}`,
                    }}
                  >
                    {DEFENSE_BADGE[adjustment].label}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <MultiplierPicker value={row.multiplier} onChange={(m) => setMultiplier(row.tokenId, m)} />
              {isMulti && assignments.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.tokenId)}
                  className="text-[10px] opacity-50 hover:opacity-100 shrink-0"
                  style={{ color: '#ef4444' }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        );})}
      </div>

      {addable.length > 0 && (
        <div className="space-y-1">
          {!showAdd ? (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="font-ui text-[10px] w-full py-1 rounded"
              style={{ border: `1px dashed ${BD}`, color: 'var(--color-text-secondary)' }}
            >
              + Add target
            </button>
          ) : (
            <div className="space-y-1 max-h-28 overflow-y-auto rounded p-1" style={{ border: `1px solid ${BD}` }}>
              {addable.map((t) => (
                <div key={t.id} className="flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => addTarget(t, 'normal')}
                    className="flex-1 text-left font-ui text-[10px] px-2 py-1 rounded hover:opacity-90"
                    style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                    title={pending.isSaveEffect ? 'Failed save — full damage' : undefined}
                  >
                    {t.name}
                    <span className="ml-1 opacity-60">{t.hp}/{t.maxHp} HP</span>
                    {pending.isSaveEffect && (
                      <span className="ml-1 font-semibold" style={{ color: '#fca5a5' }}>1×</span>
                    )}
                  </button>
                  {pending.isSaveEffect && (
                    <>
                      <button
                        type="button"
                        onClick={() => addTarget(t, 'half')}
                        className="font-ui text-[10px] px-1.5 py-1 rounded shrink-0"
                        style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
                        title="Succeeded save — half damage"
                      >
                        ½
                      </button>
                      <button
                        type="button"
                        onClick={() => addTarget(t, 'quarter')}
                        className="font-ui text-[10px] px-1.5 py-1 rounded shrink-0"
                        style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
                        title="Quarter damage (e.g. evasion, resistance stacking)"
                      >
                        ¼
                      </button>
                    </>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setShowAdd(false)} className="font-ui text-[10px] w-full py-0.5 opacity-50">Cancel</button>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={applyAll}
        disabled={assignments.length === 0}
        className="font-ui text-xs w-full py-1.5 rounded font-semibold transition-all hover:opacity-90 disabled:opacity-40"
        style={{
          background: 'rgba(239,68,68,0.2)',
          border: '1px solid #ef4444',
          color: '#fca5a5',
        }}
      >
        Apply {assignments.length > 1 ? `to ${assignments.length} targets` : 'damage'}
      </button>
    </div>
  );
}
