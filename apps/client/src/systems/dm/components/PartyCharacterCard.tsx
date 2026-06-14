import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { D5E_CONDITIONS } from '@grimoire/shared';
import type { TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { applyTokenConditionsToCombatants } from '@/systems/initiative/initiativeTokenSync';
import { patchDdbDeathSaves, patchDdbHp, syncDdbCharacter } from '@/systems/ddb/ddbApi';
import { DeathSaveTrack } from '@/systems/ddb/DeathSaveTrack';
import { normalizeDeathSaves, type DeathSavesState } from '@/systems/ddb/deathSaveRoll';
import { pullDdbHpToToken } from '@/systems/ddb/useDdbHpSync';
import { useDdbStore } from '@/systems/ddb/ddbStore';
import { BD, GOLD } from '../dmStyles';

export function PartyCharacterCard({ token }: { token: TokenItem }) {
  const qc = useQueryClient();
  const openSheet = useDdbStore((s) => s.openSheet);
  const ddbId = token.ddbCharacterId!;
  const liveToken = useItemStore((s) => {
    const item = s.items[token.id];
    return item?.type === 'token' ? item : token;
  });

  const { data: character, isLoading, isError, refetch } = useQuery({
    queryKey: ['ddb', 'character', ddbId],
    queryFn: async () => {
      const ch = await syncDdbCharacter(ddbId);
      pullDdbHpToToken(liveToken.id, ch);
      return ch;
    },
    staleTime: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncDdbCharacter(ddbId),
    onSuccess: (ch) => {
      void qc.setQueryData(['ddb', 'character', ddbId], ch);
      pullDdbHpToToken(liveToken.id, ch);
    },
  });

  const hpMutation = useMutation({
    mutationFn: ({ hp, tempHp }: { hp: number; tempHp: number }) => patchDdbHp(ddbId, hp, tempHp),
    onSuccess: (result) => {
      void qc.setQueryData(['ddb', 'character', ddbId], result.character);
      pullDdbHpToToken(liveToken.id, result.character);
    },
  });

  const deathSaveMutation = useMutation({
    mutationFn: (payload: { deathSaves: DeathSavesState; hp?: number; tempHp?: number }) =>
      patchDdbDeathSaves(ddbId, payload.deathSaves, {
        ...(payload.hp != null ? { hp: payload.hp } : {}),
        ...(payload.tempHp != null ? { tempHp: payload.tempHp } : {}),
      }),
    onSuccess: (result) => {
      void qc.setQueryData(['ddb', 'character', ddbId], result.character);
      pullDdbHpToToken(liveToken.id, result.character);
    },
  });

  function toggleTokenCondition(condition: string) {
    const has = liveToken.conditions.includes(condition);
    const conditions = has
      ? liveToken.conditions.filter((c) => c !== condition)
      : [...liveToken.conditions, condition];
    useItemStore.getState().updateItem(liveToken.id, { conditions });
    emitItemUpdate([{ id: liveToken.id, patch: { conditions } }]);
    applyTokenConditionsToCombatants(liveToken.id, conditions);
  }

  function pushDeathSaves(deathSaves: DeathSavesState, hp?: number) {
    const normalized = normalizeDeathSaves(deathSaves);
    void qc.setQueryData(['ddb', 'character', ddbId], (old: typeof character) =>
      old ? { ...old, deathSaves: normalized, ...(hp != null ? { hp } : {}) } : old,
    );
    if (hp != null) {
      useItemStore.getState().updateItem(liveToken.id, { hp });
      emitItemUpdate([{ id: liveToken.id, patch: { hp } }]);
    }
    if (liveToken.syncHpToDdb) {
      deathSaveMutation.mutate({
        deathSaves: normalized,
        ...(hp != null ? { hp } : {}),
        tempHp: character?.tempHp ?? 0,
      });
    }
  }

  function updateHp(hp: number, tempHp: number) {
    useItemStore.getState().updateItem(liveToken.id, { hp, tempHp });
    emitItemUpdate([{ id: liveToken.id, patch: { hp, tempHp } }]);
    if (liveToken.syncHpToDdb) hpMutation.mutate({ hp, tempHp });
  }

  return (
    <div
      className="rounded p-2 space-y-2"
      style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-sm truncate" style={{ color: GOLD }}>{liveToken.name}</div>
          {character && (
            <div className="text-[10px] opacity-70">
              L{character.level} · HP {character.hp}/{character.maxHp}
              {(character.tempHp ?? 0) > 0 ? ` +${character.tempHp}` : ''}
            </div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            className="btn-ghost text-[10px] py-0.5 px-1.5"
            disabled={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            Sync
          </button>
          <button type="button" className="btn-ghost text-[10px] py-0.5 px-1.5" onClick={() => openSheet(liveToken)}>
            Sheet
          </button>
        </div>
      </div>

      {isLoading && <p className="text-[10px] opacity-60">Loading from DDB…</p>}
      {isError && (
        <button type="button" className="text-[10px]" style={{ color: 'var(--color-accent-red-hot)' }} onClick={() => void refetch()}>
          Failed — retry
        </button>
      )}

      {character && (
        <>
          <div className="flex flex-wrap gap-2 items-center text-[10px]">
            <label className="flex items-center gap-1">
              HP
              <input
                type="number"
                className="w-12 px-1 rounded text-[10px]"
                style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${BD}` }}
                value={character.hp}
                min={0}
                max={character.maxHp}
                onChange={(e) => updateHp(parseInt(e.target.value, 10) || 0, character.tempHp ?? 0)}
              />
              / {character.maxHp}
            </label>
            <label className="flex items-center gap-1">
              Temp
              <input
                type="number"
                className="w-10 px-1 rounded text-[10px]"
                style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${BD}` }}
                value={character.tempHp ?? 0}
                min={0}
                onChange={(e) => updateHp(character.hp, parseInt(e.target.value, 10) || 0)}
              />
            </label>
          </div>

          <DeathSaveTrack
            deathSaves={character.deathSaves}
            characterName={character.name}
            syncEnabled={Boolean(liveToken.syncHpToDdb)}
            pending={deathSaveMutation.isPending}
            onChange={pushDeathSaves}
          />

          {character.spellSlots.some((s) => s.total > 0) && (
            <div>
              <div className="text-[10px] opacity-70 mb-1">Spell slots (DDB read-only)</div>
              <div className="flex flex-wrap gap-1">
                {character.spellSlots.map((s) => (
                  <span
                    key={s.level}
                    className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{ background: 'var(--color-bg-secondary)' }}
                  >
                    L{s.level}: {s.total - s.used}/{s.total}
                  </span>
                ))}
              </div>
              <p className="text-[9px] opacity-50 mt-0.5">Push spell slot usage to DDB — coming soon.</p>
            </div>
          )}

          {(character.conditions.length > 0 || liveToken.conditions.length > 0) && (
            <div>
              <div className="text-[10px] opacity-70 mb-1">Conditions</div>
              {character.conditions.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {character.conditions.map((c) => (
                    <span key={`ddb-${c}`} className="text-[10px] px-1.5 py-0.5 rounded opacity-80" style={{ border: `1px solid ${BD}` }}>
                      DDB: {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="text-[10px] opacity-70 mb-1">Map token conditions</div>
            <div className="flex flex-wrap gap-0.5">
              {D5E_CONDITIONS.map((cond) => {
                const on = liveToken.conditions.includes(cond);
                return (
                  <button
                    key={cond}
                    type="button"
                    className="text-[9px] px-1 py-0.5 rounded"
                    style={{
                      background: on ? 'rgba(201,168,76,0.2)' : 'transparent',
                      border: `1px solid ${on ? GOLD : BD}`,
                      color: on ? GOLD : 'var(--color-text-secondary)',
                    }}
                    onClick={() => toggleTokenCondition(cond)}
                  >
                    {cond}
                  </button>
                );
              })}
            </div>
          </div>

          {character.inventory.length > 0 && (
            <div>
              <div className="text-[10px] opacity-70 mb-1">Inventory (DDB)</div>
              <div className="max-h-24 overflow-y-auto space-y-0.5">
                {character.inventory.slice(0, 12).map((item) => (
                  <div key={item.id} className="text-[10px] truncate opacity-85">
                    {item.equipped ? '⚔ ' : ''}{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}
                  </div>
                ))}
                {character.inventory.length > 12 && (
                  <div className="text-[9px] opacity-50">+{character.inventory.length - 12} more — open Sheet</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
