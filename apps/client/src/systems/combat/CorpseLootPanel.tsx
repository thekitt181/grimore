import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { useSessionStore } from '@/store/sessionStore';
import type { LootDrop } from '@/systems/compendium/compendiumApi';
import { rollLoot } from '@/systems/compendium/compendiumApi';
import { guessLootSource, LOOT_SOURCES } from '@/systems/compendium/LootRoller';
import { partyLevelFromTokens } from '@/systems/combat/partyLevel';
import { useMapStore } from '@/systems/map/store/mapStore';
import { setPlayersCanLootForSession } from '@/systems/combat/lootPolicySync';
import {
  corpseDrops,
  setCorpseLootDrops,
  splitCorpseLoot,
  takeCorpseLoot,
  useCorpseLootUi,
} from './corpseLoot';

const GOLD = 'var(--color-accent-gold)';

interface HeldDrop {
  key: string;
  drop: LootDrop;
}

let heldKey = 0;
function nextKey(): string {
  heldKey += 1;
  return `corpse-${heldKey}`;
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function dropTitle(drop: LootDrop): string {
  return drop.kind === 'currency' ? drop.label : drop.name;
}

function dropNote(drop: LootDrop): string {
  if (drop.kind === 'item') return [drop.rarity, drop.type].filter(Boolean).join(' · ') || 'Codex item';
  if (drop.kind === 'flavor') return 'Flavor';
  return 'Coins';
}

function crLevel(token: TokenItem): number | null {
  const raw = String(token.monsterCr ?? '').trim();
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace('1/8', '0.125').replace('1/4', '0.25').replace('1/2', '0.5'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampLevel(Math.max(1, Math.round(n)));
}

export function CorpseLootPanel() {
  const tokenId = useCorpseLootUi((s) => s.tokenId);
  const close = useCorpseLootUi((s) => s.close);
  const qc = useQueryClient();
  const isGM = useSessionStore((s) => s.myRole) === 'GM';
  const playersCanLoot = useMapStore((s) => s.playersCanLoot);
  const canTake = isGM || playersCanLoot;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [levelText, setLevelText] = useState('');
  const [minCount, setMinCount] = useState(1);
  const [maxCount, setMaxCount] = useState(6);
  const [source, setSource] = useState('this');
  const [current, setCurrent] = useState<HeldDrop[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [kept, setKept] = useState<HeldDrop[]>([]);
  const [splitIds, setSplitIds] = useState<Record<string, boolean>>({});
  const token = useItemStore((s) => {
    if (!tokenId) return null;
    const item = s.items[tokenId];
    return item?.type === 'token' ? item : null;
  });
  const pcs = useItemStore((s) =>
    Object.values(s.items).filter((i): i is TokenItem => i.type === 'token' && Boolean(i.ddbCharacterId)),
  );
  const suggested = partyLevelFromTokens();
  const fromCr = token ? crLevel(token) : null;

  useEffect(() => {
    if (!token) return;
    setMsg('');
    setError(null);
    setSummary(null);
    setSource(guessLootSource(token.name));
    setLevelText(fromCr != null ? String(fromCr) : suggested != null ? String(suggested) : '');
    setMinCount(1);
    setMaxCount(6);
    setKept([]);
    setPicked({});
    setSplitIds({});
    setCurrent(corpseDrops(token.corpseLoot).map((drop) => ({ key: nextKey(), drop })));
  // Only reset when opening a different corpse.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId]);

  if (!token || token.hp > 0 || !token.corpseLoot) return null;
  const loot = token.corpseLoot;
  const claimed = Boolean(loot.claimed);
  const low = Math.min(minCount, maxCount);
  const high = Math.max(minCount, maxCount);
  const checked = current.filter((row) => picked[row.key]);
  const selected = [...kept, ...checked];
  const ready = selected.length;
  const splitTargets = pcs.filter((pc) => splitIds[pc.id] === true);
  const splitCount = splitTargets.length;

  function persist(rows: HeldDrop[]) {
    setCorpseLootDrops(token!.id, rows.map((row) => row.drop), false);
  }

  function toggle(key: string) {
    setPicked((rows) => ({ ...rows, [key]: !rows[key] }));
  }

  async function roll(keepChecked: boolean) {
    if (busy || claimed) return;
    const moving = keepChecked ? checked : [];
    setBusy(true);
    setError(null);
    setMsg('');
    try {
      const trimmed = levelText.trim();
      const level = trimmed === '' ? undefined : clampLevel(Number(trimmed));
      const next = await rollLoot({
        min: low,
        max: high,
        source,
        name: token!.name,
        ...(level != null ? { level } : {}),
      });
      const nextKept = [...kept, ...moving];
      const nextCurrent = next.drops.map((drop) => ({ key: nextKey(), drop }));
      setKept(nextKept);
      setCurrent(nextCurrent);
      setPicked({});
      setSummary(`${next.count} from ${next.source} · ${next.partyLevel == null ? 'any level' : `level ${next.partyLevel}`}`);
      persist([...nextKept, ...nextCurrent]);
    } catch {
      setError('Could not roll loot. The item codex may still be loading.');
    } finally {
      setBusy(false);
    }
  }

  function removeGiven(keys: Set<string>) {
    const nextKept = kept.filter((row) => !keys.has(row.key));
    const nextCurrent = current.filter((row) => !keys.has(row.key));
    setKept(nextKept);
    setCurrent(nextCurrent);
    setPicked({});
  }

  async function giveTo(ddbCharacterId: number) {
    if (!canTake) return;
    if (ready === 0) {
      setError('Tick the drops you want, then give them.');
      return;
    }
    setBusy(true);
    setMsg('');
    setError(null);
    try {
      const result = await takeCorpseLoot(token!, ddbCharacterId, selected.map((row) => row.drop));
      setMsg(result.message);
      removeGiven(new Set(selected.map((row) => row.key)));
      void qc.invalidateQueries({ queryKey: ['ddb', 'character', ddbCharacterId] });
      if (result.character) qc.setQueryData(['ddb', 'character', ddbCharacterId], result.character);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not take loot');
    } finally {
      setBusy(false);
    }
  }

  async function splitAmong() {
    const targets = splitTargets.filter((pc) => pc.ddbCharacterId);
    if (ready === 0) {
      setError('Tick the coins or stacks you want to split.');
      return;
    }
    if (targets.length < 2) {
      setError('Tick at least two players to split among.');
      return;
    }
    setBusy(true);
    setMsg('');
    setError(null);
    try {
      const result = await splitCorpseLoot(
        token!,
        targets.map((pc) => ({ ddbCharacterId: pc.ddbCharacterId!, name: pc.name })),
        selected.map((row) => row.drop),
      );
      setMsg(result.message);
      if (result.ok) {
        const leftoverNames = new Set(result.leftover.map((d) => (d.kind === 'currency' ? d.label : d.name)));
        const taken = new Set(
          selected
            .filter((row) => !leftoverNames.has(row.drop.kind === 'currency' ? row.drop.label : row.drop.name))
            .map((row) => row.key),
        );
        removeGiven(taken);
        for (const pc of targets) {
          void qc.invalidateQueries({ queryKey: ['ddb', 'character', pc.ddbCharacterId] });
        }
      } else {
        setError(result.message);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not split loot');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DraggablePanel
      title={`Loot · ${token.name}`}
      onClose={close}
      width={300}
      defaultPosition={{ x: 72, y: 120 }}
    >
      <div className="px-2 pb-2 font-ui text-[11px] space-y-2">
        {claimed ? (
          <p style={{ color: 'var(--color-text-secondary)' }}>Already taken.</p>
        ) : (
          <>
            {isGM && (
              <>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={playersCanLoot}
                    onChange={() => setPlayersCanLootForSession(!playersCanLoot)}
                  />
                  <span className="text-xs" style={{ color: 'var(--color-text-primary)' }}>
                    Players can take loot
                  </span>
                </label>
                <p className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  Off: players only see the pile. On: they can take ticked drops onto their own sheet.
                </p>
                <label className="block space-y-1">
                  <span className="uppercase tracking-wider text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                    Where it comes from
                  </span>
                  <select
                    className="input-dark w-full text-xs py-1"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                  >
                    {LOOT_SOURCES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.id === 'this' ? `This (${token.name})` : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="uppercase tracking-wider text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                    Party level
                  </span>
                  <input
                    className="input-dark w-full text-xs py-1"
                    inputMode="numeric"
                    placeholder="Blank for any level"
                    value={levelText}
                    onChange={(event) => setLevelText(event.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                  />
                </label>
                {suggested != null && levelText !== String(suggested) && (
                  <button
                    type="button"
                    className="text-xs text-left"
                    style={{ color: GOLD }}
                    onClick={() => setLevelText(String(suggested))}
                  >
                    Use party average ({suggested})
                  </button>
                )}
                {fromCr != null && levelText !== String(fromCr) && (
                  <button
                    type="button"
                    className="text-xs text-left block"
                    style={{ color: GOLD }}
                    onClick={() => setLevelText(String(fromCr))}
                  >
                    Use creature CR ({fromCr})
                  </button>
                )}
                <div className="flex gap-2">
                  <label className="flex-1 space-y-1">
                    <span className="uppercase tracking-wider text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Min</span>
                    <input
                      className="input-dark w-full text-xs py-1"
                      type="number"
                      min={1}
                      max={20}
                      value={minCount}
                      onChange={(event) => setMinCount(clampCount(Number(event.target.value)))}
                    />
                  </label>
                  <label className="flex-1 space-y-1">
                    <span className="uppercase tracking-wider text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Max</span>
                    <input
                      className="input-dark w-full text-xs py-1"
                      type="number"
                      min={1}
                      max={20}
                      value={maxCount}
                      onChange={(event) => setMaxCount(clampCount(Number(event.target.value)))}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn-primary w-full text-xs py-1.5"
                  disabled={busy}
                  onClick={() => { void roll(current.length > 0); }}
                >
                  {busy ? 'Rolling…' : current.length > 0 || kept.length > 0 ? 'Reroll' : `Roll ${low}–${high}`}
                </button>
                {summary && (
                  <p className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{summary}</p>
                )}
              </>
            )}
            {error && (
              <p className="text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>
            )}
            {kept.length > 0 && (
              <div className="space-y-1">
                <p className="uppercase tracking-wider text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Kept</p>
                {kept.map((row) => (
                  <div key={row.key} className="flex items-start gap-1.5">
                    <span className="text-xs flex-1 min-w-0" style={{ color: 'var(--color-text-primary)' }}>{dropTitle(row.drop)}</span>
                    {isGM && (
                      <button
                        type="button"
                        className="text-xs opacity-40 hover:opacity-100"
                        style={{ color: 'var(--color-accent-red-hot)' }}
                        title="Drop this"
                        onClick={() => {
                          const next = kept.filter((entry) => entry.key !== row.key);
                          setKept(next);
                          persist([...next, ...current]);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {current.length > 0 && (
              <div className="space-y-1">
                {current.map((row) => (
                  canTake ? (
                    <label key={row.key} className="flex items-start gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={Boolean(picked[row.key])}
                        onChange={() => toggle(row.key)}
                      />
                      <span className="min-w-0">
                        <span className="text-xs block leading-snug" style={{ color: 'var(--color-text-primary)' }}>{dropTitle(row.drop)}</span>
                        <span className="text-[10px] block" style={{ color: 'var(--color-text-secondary)' }}>{dropNote(row.drop)}</span>
                      </span>
                    </label>
                  ) : (
                    <div key={row.key}>
                      <span className="text-xs block leading-snug" style={{ color: 'var(--color-text-primary)' }}>{dropTitle(row.drop)}</span>
                      <span className="text-[10px] block" style={{ color: 'var(--color-text-secondary)' }}>{dropNote(row.drop)}</span>
                    </div>
                  )
                ))}
              </div>
            )}
            {!isGM && current.length === 0 && kept.length === 0 && (
              <p style={{ color: 'var(--color-text-secondary)' }}>Waiting for the GM to roll loot.</p>
            )}
            {canTake ? (
              <>
                <p style={{ color: 'var(--color-text-secondary)' }}>
                  Give ticked drops to a player sheet (D&amp;D Beyond):
                </p>
                <div className="flex flex-col gap-1">
                  {pcs.length === 0 && (
                    <p style={{ color: 'var(--color-text-secondary)' }}>No D&amp;D Beyond PCs on the map.</p>
                  )}
                  {pcs.map((pc) => (
                    <div key={pc.id} className="flex items-center gap-1">
                      <label className="flex items-center gap-1 shrink-0" title="Include in split">
                        <input
                          type="checkbox"
                          checked={splitIds[pc.id] === true}
                          onChange={() => setSplitIds((rows) => ({ ...rows, [pc.id]: !rows[pc.id] }))}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn-ghost text-left text-[11px] px-2 py-1 flex-1 min-w-0"
                        disabled={busy || ready === 0}
                        onClick={() => void giveTo(pc.ddbCharacterId!)}
                      >
                        {pc.name}{ready > 0 ? ` · ${ready}` : ''}
                      </button>
                    </div>
                  ))}
                </div>
                {pcs.length >= 2 && (
                  <button
                    type="button"
                    className="btn-primary w-full text-xs py-1.5"
                    disabled={busy || ready === 0 || splitCount < 2}
                    onClick={() => { void splitAmong(); }}
                  >
                    Split among {splitCount >= 2 ? splitCount : '…'} players
                  </button>
                )}
                <p className="text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                  Tick loot, tick players, then split. Remainder coins and extra items go to the first ticked players. Unique items stay on the corpse. Gold goes to D&amp;D Beyond currency.
                </p>
              </>
            ) : (
              <p className="text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                View only — the GM will hand this out.
              </p>
            )}
          </>
        )}
        {msg && <p style={{ color: GOLD }}>{msg}</p>}
      </div>
    </DraggablePanel>
  );
}
