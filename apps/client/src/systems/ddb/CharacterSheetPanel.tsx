import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DraggablePanel } from '@/components/DraggablePanel';
import type { GrimoireCharacter } from '@grimoire/shared';
import { rollDice } from '@grimoire/dice-engine';
import type { TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useDiceStore } from '@/systems/dice/diceStore';
import { patchDdbDeathSaves, patchDdbHp, syncDdbCharacter } from './ddbApi';
import {
  applyDeathSaveRoll,
  clearDeathSaves,
  normalizeDeathSaves,
  setDeathSaveCount,
  type DeathSavesState,
} from './deathSaveRoll';
import { parsePcActions } from './ddbActionParser';
import { pullDdbHpToToken } from './useDdbHpSync';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { useDdbStore } from './ddbStore';
import { ddbPanelPosition, ddbPanelWidth } from './ddbTokenUtils';
import { buildSpellLookup } from '@/systems/compendium/statBlockParser';
import { searchSpells } from '@/systems/compendium/compendiumApi';
import { useCombatStore } from '@/systems/combat/combatStore';
import { PanelAttackResult, PanelTargetPicker } from '@/systems/combat/TokenPanelCombatFlow';
import { TokenActionCard } from '@/systems/combat/TokenActionCard';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export function CharacterSheetPanel({ token, onClose }: { token: TokenItem; onClose: () => void }) {
  const qc = useQueryClient();
  const openPcActions = useDdbStore((s) => s.openPcActions);
  const ddbId = token.ddbCharacterId;
  const liveToken = useItemStore((s) => {
    const item = s.items[token.id];
    return item?.type === 'token' ? (item as TokenItem) : token;
  });

  const { data: character, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ddb', 'character', ddbId],
    queryFn: async () => {
      const ch = await syncDdbCharacter(ddbId!);
      pullDdbHpToToken(liveToken.id, ch);
      return ch;
    },
    enabled: Boolean(ddbId),
    staleTime: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncDdbCharacter(ddbId!),
    onSuccess: (ch) => {
      void qc.setQueryData(['ddb', 'character', ddbId], ch);
      pullDdbHpToToken(liveToken.id, ch);
    },
  });

  const hpMutation = useMutation({
    mutationFn: ({ hp, tempHp }: { hp: number; tempHp: number }) => patchDdbHp(ddbId!, hp, tempHp),
    onSuccess: (result) => {
      void qc.setQueryData(['ddb', 'character', ddbId], result.character);
      pullDdbHpToToken(liveToken.id, result.character);
    },
  });

  const deathSaveMutation = useMutation({
    mutationFn: (payload: { deathSaves: DeathSavesState; hp?: number; tempHp?: number }) =>
      patchDdbDeathSaves(ddbId!, payload.deathSaves, {
        ...(payload.hp != null ? { hp: payload.hp } : {}),
        ...(payload.tempHp != null ? { tempHp: payload.tempHp } : {}),
      }),
    onSuccess: (result) => {
      void qc.setQueryData(['ddb', 'character', ddbId], result.character);
      pullDdbHpToToken(liveToken.id, result.character);
    },
  });

  function pushDeathSaves(deathSaves: DeathSavesState, hp?: number, tempHp?: number) {
    const normalized = normalizeDeathSaves(deathSaves);
    void qc.setQueryData(['ddb', 'character', ddbId], (old: GrimoireCharacter | undefined) =>
      old
        ? {
            ...old,
            deathSaves: normalized,
            ...(hp != null ? { hp } : {}),
            ...(tempHp != null ? { tempHp } : {}),
          }
        : old,
    );
    if (hp != null || tempHp != null) {
      const patch: Partial<TokenItem> = {};
      if (hp != null) patch.hp = hp;
      if (tempHp != null) patch.tempHp = tempHp;
      useItemStore.getState().updateItem(liveToken.id, patch);
      emitItemUpdate([{ id: liveToken.id, patch }]);
    }
    if (liveToken.syncHpToDdb) {
      deathSaveMutation.mutate({
        deathSaves: normalized,
        ...(hp != null ? { hp } : {}),
        ...(tempHp != null ? { tempHp } : { tempHp: character?.tempHp ?? 0 }),
      });
    }
  }

  function updateLocalHp(hp: number, tempHp: number) {
    const patch = { hp, tempHp };
    useItemStore.getState().updateItem(liveToken.id, patch);
    emitItemUpdate([{ id: liveToken.id, patch }]);
    if (liveToken.syncHpToDdb) {
      hpMutation.mutate({ hp, tempHp });
    }
  }

  const { data: spellData } = useQuery({
    queryKey: ['compendium', 'spells', 'lookup'],
    queryFn: () => searchSpells({ limit: 5000 }),
    staleTime: 5 * 60_000,
  });

  const lookup = buildSpellLookup(spellData?.items ?? []);

  if (!ddbId) {
    return (
      <SheetShell title={liveToken.name} onClose={onClose}>
        <p style={{ color: 'var(--color-accent-red-hot)' }}>This token is not linked to a D&amp;D Beyond character.</p>
      </SheetShell>
    );
  }

  return (
    <SheetShell title={liveToken.name} onClose={onClose}>
      {isLoading && <p style={{ color: 'var(--color-text-secondary)' }}>Loading sheet…</p>}
      {isError && (
        <div className="space-y-2">
          <p style={{ color: 'var(--color-accent-red-hot)' }}>
            {error instanceof Error ? error.message : 'Failed to load character'}
          </p>
          <button type="button" className="btn-ghost text-[10px]" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      )}
      {character && (
        <SheetBody
          character={character}
          liveToken={liveToken}
          lookup={lookup}
          syncPending={syncMutation.isPending}
          deathSavePending={deathSaveMutation.isPending}
          onSync={() => syncMutation.mutate()}
          onHpChange={updateLocalHp}
          onDeathSavesChange={(deathSaves, hp) =>
            pushDeathSaves(deathSaves, hp, character.tempHp ?? 0)
          }
          onOpenActions={() => openPcActions(liveToken)}
        />
      )}
    </SheetShell>
  );
}

function SheetBody({
  character,
  liveToken,
  lookup,
  syncPending,
  deathSavePending,
  onSync,
  onHpChange,
  onDeathSavesChange,
  onOpenActions,
}: {
  character: GrimoireCharacter;
  liveToken: TokenItem;
  lookup: ReturnType<typeof buildSpellLookup>;
  syncPending: boolean;
  deathSavePending: boolean;
  onSync: () => void;
  onHpChange: (hp: number, tempHp: number) => void;
  onDeathSavesChange: (deathSaves: DeathSavesState, hp?: number) => void;
  onOpenActions: () => void;
}) {
  const roller = liveToken.name;
  const targetPick = useCombatStore((s) => s.targetPick);
  const parsedCombat = parsePcActions(character, lookup);
  const spells = character.spells ?? [];
  const spellSlots = character.spellSlots ?? [];
  const inventory = character.inventory ?? [];
  const abilities = character.abilities ?? [];
  const skills = character.skills ?? [];
  const saves = character.saves ?? [];
  const features = character.features ?? [];
  const feats = character.feats ?? [];
  const conditions = character.conditions ?? [];
  const resistances = character.damageResistances ?? [];
  const immunities = character.damageImmunities ?? [];
  const vulnerabilities = character.damageVulnerabilities ?? [];
  const conditionImmunities = character.conditionImmunities ?? [];
  const hasDefenses =
    resistances.length > 0 ||
    immunities.length > 0 ||
    vulnerabilities.length > 0 ||
    conditionImmunities.length > 0;

  const activePickName =
    targetPick?.attackerTokenId === liveToken.id ? targetPick.actionName : null;

  return (
    <>
      <PanelTargetPicker token={liveToken} />
      <PanelAttackResult token={liveToken} />

      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn-primary text-[10px]" disabled={syncPending} onClick={onSync}>
          {syncPending ? 'Syncing…' : 'Sync from DDB'}
        </button>
        <button type="button" className="btn-ghost text-[10px]" onClick={onOpenActions}>
          Combat actions
        </button>
        {character.lastSyncedAt && (
          <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            {new Date(character.lastSyncedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {(character.classes.length > 0 || character.level) && (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Level {character.level}
          {character.classes.length ? ` · ${character.classes.join(', ')}` : ''}
          {character.race ? ` · ${character.race}` : ''}
          {' · Prof '}
          {formatMod(character.proficiencyBonus)}
        </p>
      )}

      <Section title="Vitals">
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-1">
            HP
            <input
              type="number"
              className="w-14 px-1 rounded"
              style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
              value={character.hp}
              min={0}
              max={character.maxHp}
              onChange={(e) => onHpChange(parseInt(e.target.value, 10) || 0, character.tempHp ?? 0)}
            />
            / {character.maxHp}
          </label>
          <label className="flex items-center gap-1">
            Temp
            <input
              type="number"
              className="w-12 px-1 rounded"
              style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
              value={character.tempHp ?? 0}
              min={0}
              onChange={(e) => onHpChange(character.hp, parseInt(e.target.value, 10) || 0)}
            />
          </label>
          <span>AC {character.ac}</span>
          {character.inspiration && <span>★ Inspiration</span>}
        </div>
        <DeathSaveTrack
          deathSaves={character.deathSaves}
          characterName={roller}
          syncEnabled={Boolean(liveToken.syncHpToDdb)}
          pending={deathSavePending}
          onChange={onDeathSavesChange}
        />
        {conditions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {conditions.map((c) => (
              <Tag key={c} label={c} tone="condition" />
            ))}
          </div>
        )}
      </Section>

      {hasDefenses && (
        <Section title="Defenses">
          {resistances.length > 0 && (
            <DefenseRow label="Resistances" items={resistances} tone="resistance" />
          )}
          {immunities.length > 0 && (
            <DefenseRow label="Immunities" items={immunities} tone="immunity" />
          )}
          {vulnerabilities.length > 0 && (
            <DefenseRow label="Vulnerabilities" items={vulnerabilities} tone="vulnerability" />
          )}
          {conditionImmunities.length > 0 && (
            <DefenseRow label="Condition immunities" items={conditionImmunities} tone="conditionImmunity" />
          )}
        </Section>
      )}

      {feats.length > 0 && (
        <Section title="Feats">
          {feats.map((f) => (
            <div key={f.id} className="py-1 border-b border-white/5 last:border-0">
              <div style={{ color: GOLD }}>{f.name}</div>
              {f.description && (
                <div className="opacity-70 text-[10px] leading-snug mt-0.5">{stripHtml(f.description)}</div>
              )}
            </div>
          ))}
        </Section>
      )}

      {abilities.length > 0 && (
        <Section title="Abilities">
          <div className="grid grid-cols-6 gap-1 text-center">
            {abilities.map((a) => (
              <div key={a.name} className="rounded px-1 py-1" style={{ background: 'var(--color-bg-tertiary)' }}>
                <div className="text-[9px] opacity-70">{a.name}</div>
                <div className="font-display" style={{ color: GOLD }}>{a.score}</div>
                <RollChip label={`${roller} · ${a.name} check`} mod={a.mod ?? 0} compact />
              </div>
            ))}
          </div>
        </Section>
      )}

      {saves.length > 0 && (
        <Section title="Saving throws">
          <div className="grid grid-cols-3 gap-1">
            {saves.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between gap-1 rounded px-2 py-1"
                style={{ background: 'var(--color-bg-tertiary)' }}
              >
                <span className="truncate">
                  {s.proficient ? '● ' : '○ '}
                  {s.name}
                </span>
                <RollChip label={`${roller} · ${s.name} save`} mod={s.mod} compact />
              </div>
            ))}
          </div>
        </Section>
      )}

      {skills.length > 0 && (
        <Section title="Skills">
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {skills.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-1 py-0.5 min-w-0">
                <span className="truncate text-[10px]">
                  {s.proficient ? '● ' : '○ '}
                  {s.name}
                </span>
                <RollChip label={`${roller} · ${s.name}`} mod={s.mod} compact />
              </div>
            ))}
          </div>
        </Section>
      )}

      {spellSlots.some((s) => s.total > 0) && (
        <Section title="Spell slots">
          <div className="flex flex-wrap gap-2">
            {spellSlots.map((s) => (
              <span key={s.level} className="px-2 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
                L{s.level}: {s.total - s.used}/{s.total}
              </span>
            ))}
          </div>
          {character.spellSaveDc != null && (
            <p className="mt-1 opacity-80">
              Spell DC {character.spellSaveDc}
              {character.spellAttackMod != null ? ` · Spell atk ${formatMod(character.spellAttackMod)}` : ''}
            </p>
          )}
        </Section>
      )}

      {parsedCombat.attacks.length > 0 && (
        <Section title="Weapon attacks">
          {parsedCombat.attacks.map((parsed) => (
            <div key={parsed.name} className="flex items-center justify-between gap-2 py-0.5">
              <span className="truncate min-w-0">
                <span style={{ color: GOLD }}>{parsed.name}</span>
                {parsed.damages[0] ? (
                  <span className="opacity-70"> · {parsed.damages[0].dice} {parsed.damages[0].type}</span>
                ) : null}
              </span>
              <RollChip label={`${roller} · ${parsed.name} attack`} mod={parsed.toHit ?? 0} compact />
            </div>
          ))}
        </Section>
      )}

      {features.length > 0 && (
        <Section title="Class features & actions">
          {features.slice(0, 25).map((f) => (
            <div key={f.id} className="py-1 border-b border-white/5 last:border-0">
              <div style={{ color: GOLD }}>{f.name}</div>
              {f.description && (
                <div className="opacity-70 text-[10px] leading-snug mt-0.5">{stripHtml(f.description)}</div>
              )}
            </div>
          ))}
          {features.length > 25 && (
            <div className="opacity-60">+{features.length - 25} more</div>
          )}
        </Section>
      )}

      {parsedCombat.spells.length > 0 && (
        <Section title="Spells">
          <div className="space-y-1">
            {parsedCombat.spells.map((action) => (
              <TokenActionCard
                key={action.name}
                action={action}
                token={liveToken}
                isActivePick={activePickName === action.name}
                compact
              />
            ))}
          </div>
          {spells.length > parsedCombat.spells.length && (
            <p className="font-ui text-[10px] mt-1 opacity-60">
              +{spells.length - parsedCombat.spells.length} unprepared spells hidden
            </p>
          )}
        </Section>
      )}

      {inventory.length > 0 && (
        <Section title="Inventory">
          {inventory.map((i) => (
            <div key={i.id} className="py-0.5 truncate">
              {i.equipped ? '⚔ ' : ''}
              {i.name}
              {i.quantity > 1 ? ` ×${i.quantity}` : ''}
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function RollChip({ label, mod, compact }: { label: string; mod: number; compact?: boolean }) {
  const rollMode = useDiceStore((s) => s.rollMode);
  const notation = `1d20${mod >= 0 ? `+${mod}` : mod}`;

  return (
    <button
      type="button"
      className={`shrink-0 rounded font-mono hover:opacity-100 opacity-85 ${compact ? 'text-[10px] px-1 py-0' : 'text-xs px-2 py-0.5'}`}
      style={{ background: 'rgba(201,168,76,0.15)', border: `1px solid ${BD}`, color: GOLD }}
      title={`Roll ${notation}`}
      onClick={() => {
        useDiceStore.getState().performRoll(notation, label, { rollMode });
      }}
    >
      {formatMod(mod)}
    </button>
  );
}

function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : String(mod);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function SheetShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DraggablePanel
      title={title}
      subtitle="D&D Beyond character"
      onClose={onClose}
      defaultPosition={ddbPanelPosition(16, 56)}
      width={ddbPanelWidth(420)}
      maxHeight="calc(100vh - 72px)"
      zIndex={150}
      footer="Powered by D&D Beyond"
    >
      <div className="p-3 space-y-3 text-xs font-ui">{children}</div>
    </DraggablePanel>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="font-display text-[10px] tracking-wider mb-1" style={{ color: GOLD }}>{title}</h4>
      {children}
    </div>
  );
}

function DeathSaveTrack({
  deathSaves,
  characterName,
  syncEnabled,
  pending,
  onChange,
}: {
  deathSaves: GrimoireCharacter['deathSaves'];
  characterName: string;
  syncEnabled: boolean;
  pending: boolean;
  onChange: (deathSaves: DeathSavesState, hp?: number) => void;
}) {
  const rollMode = useDiceStore((s) => s.rollMode);
  const state = normalizeDeathSaves(deathSaves);
  const { successes, failures, stabilized } = state;
  const canRoll = !stabilized && successes < 3 && failures < 3;

  function applyChange(next: DeathSavesState, hp?: number) {
    onChange(normalizeDeathSaves(next), hp);
  }

  function handleRoll() {
    const result = rollDice('1d20', rollMode);
    let outcome: string;
    if (result.isCrit) outcome = 'Nat 20 — regain 1 HP';
    else if (result.isCritFail) outcome = 'Nat 1 — 2 failures';
    else if (result.total >= 10) outcome = `Success (${result.total})`;
    else outcome = `Failure (${result.total})`;

    useDiceStore.getState().performRoll('1d20', `${characterName} · death save — ${outcome}`, {
      rollMode,
      result,
    });

    const applied = applyDeathSaveRoll(state, result);
    applyChange(applied.deathSaves, applied.hp);
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] opacity-70">Death saves</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="shrink-0 rounded font-mono text-[10px] px-1.5 py-0 hover:opacity-100 opacity-85 disabled:opacity-40"
            style={{ background: 'rgba(201,168,76,0.15)', border: `1px solid ${BD}`, color: GOLD }}
            title="Roll death save (d20, 10+ success)"
            disabled={!canRoll || pending}
            onClick={handleRoll}
          >
            Roll d20
          </button>
          <button
            type="button"
            className="text-[10px] opacity-60 hover:opacity-100 disabled:opacity-30"
            title="Clear death saves"
            disabled={pending || (successes === 0 && failures === 0 && !stabilized)}
            onClick={() => applyChange(clearDeathSaves())}
          >
            Reset
          </button>
        </div>
      </div>
      {!syncEnabled && (
        <div className="text-[9px] opacity-50">Enable Push HP in token settings to sync death saves to DDB.</div>
      )}
      <div className="flex flex-wrap gap-3 items-center text-[10px]">
        <DeathSaveDots
          label="Successes"
          count={successes}
          tone="success"
          disabled={pending}
          onSetCount={(count) => applyChange(setDeathSaveCount(state, 'successes', count))}
        />
        <DeathSaveDots
          label="Failures"
          count={failures}
          tone="failure"
          disabled={pending}
          onSetCount={(count) => applyChange(setDeathSaveCount(state, 'failures', count))}
        />
        {stabilized && <Tag label="Stabilized" tone="immunity" />}
        {successes === 0 && failures === 0 && !stabilized && (
          <span className="opacity-50">None</span>
        )}
      </div>
    </div>
  );
}

function DeathSaveDots({
  label,
  count,
  tone,
  disabled,
  onSetCount,
}: {
  label: string;
  count: number;
  tone: 'success' | 'failure';
  disabled: boolean;
  onSetCount: (count: number) => void;
}) {
  const activeColor = tone === 'success' ? '#4ade80' : '#f87171';
  return (
    <span className="inline-flex items-center gap-1">
      {label}{' '}
      {[0, 1, 2].map((i) => {
        const filled = i < count;
        return (
          <button
            key={`${label}-${i}`}
            type="button"
            disabled={disabled}
            className="leading-none disabled:opacity-40 hover:opacity-100"
            style={{ color: filled ? activeColor : 'var(--color-text-secondary)' }}
            title={`Set ${label.toLowerCase()} to ${i + 1}`}
            onClick={() => onSetCount(i + 1)}
          >
            {filled ? '●' : '○'}
          </button>
        );
      })}
      <button
        type="button"
        disabled={disabled || count === 0}
        className="ml-0.5 opacity-50 hover:opacity-100 disabled:opacity-20 text-[9px]"
        title={`Clear ${label.toLowerCase()}`}
        onClick={() => onSetCount(0)}
      >
        ×
      </button>
    </span>
  );
}

type TagTone = 'resistance' | 'immunity' | 'vulnerability' | 'conditionImmunity' | 'condition';

const TAG_STYLES: Record<TagTone, { bg: string; border: string; color: string }> = {
  resistance: { bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.35)', color: '#93c5fd' },
  immunity: { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.35)', color: '#86efac' },
  vulnerability: { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', color: '#fca5a5' },
  conditionImmunity: { bg: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.35)', color: '#d8b4fe' },
  condition: { bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)', color: '#fcd34d' },
};

function Tag({ label, tone }: { label: string; tone: TagTone }) {
  const style = TAG_STYLES[tone];
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px]"
      style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
    >
      {label}
    </span>
  );
}

function DefenseRow({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: TagTone;
}) {
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="text-[10px] opacity-70 mb-0.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Tag key={item} label={item} tone={tone} />
        ))}
      </div>
    </div>
  );
}
