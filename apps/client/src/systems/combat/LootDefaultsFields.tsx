import { useMapStore } from '@/systems/map/store/mapStore';
import { partyLevelFromTokens } from '@/systems/combat/partyLevel';
import {
  clampLootCount,
  clampLootLevel,
  setLootDefaultsForSession,
} from './lootPolicySync';

export function LootDefaultsFields({ compact = false }: { compact?: boolean }) {
  const lootLevel = useMapStore((s) => s.lootLevel);
  const lootMin = useMapStore((s) => s.lootMin);
  const lootMax = useMapStore((s) => s.lootMax);
  const suggested = partyLevelFromTokens();
  const levelText = lootLevel == null ? '' : String(lootLevel);
  const labelCls = compact
    ? 'font-ui text-[8px] uppercase tracking-wider'
    : 'font-ui text-[10px] uppercase tracking-wider';
  const inputCls = compact ? 'input-dark w-full text-[10px] py-0.5' : 'input-dark w-full text-xs py-1';

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      <label className="block space-y-0.5">
        <span className={labelCls} style={{ color: 'var(--color-text-secondary)' }}>
          Loot level
        </span>
        <input
          className={inputCls}
          inputMode="numeric"
          placeholder="Any"
          value={levelText}
          onChange={(event) => {
            const raw = event.target.value.replace(/[^\d]/g, '').slice(0, 2);
            setLootDefaultsForSession({ lootLevel: raw === '' ? null : clampLootLevel(Number(raw)) });
          }}
        />
      </label>
      {!compact && suggested != null && lootLevel !== suggested && (
        <button
          type="button"
          className="font-ui text-xs text-left"
          style={{ color: 'var(--color-accent-gold)' }}
          onClick={() => setLootDefaultsForSession({ lootLevel: suggested })}
        >
          Use party average ({suggested})
        </button>
      )}
      <div className="flex gap-1">
        <label className="flex-1 space-y-0.5">
          <span className={labelCls} style={{ color: 'var(--color-text-secondary)' }}>Min</span>
          <input
            className={inputCls}
            type="number"
            min={1}
            max={20}
            value={lootMin}
            onChange={(event) => setLootDefaultsForSession({ lootMin: clampLootCount(Number(event.target.value)) })}
          />
        </label>
        <label className="flex-1 space-y-0.5">
          <span className={labelCls} style={{ color: 'var(--color-text-secondary)' }}>Max</span>
          <input
            className={inputCls}
            type="number"
            min={1}
            max={20}
            value={lootMax}
            onChange={(event) => setLootDefaultsForSession({ lootMax: clampLootCount(Number(event.target.value)) })}
          />
        </label>
      </div>
      {compact && (
        <p className="font-ui text-[8px] leading-tight" style={{ color: 'var(--color-text-secondary)' }}>
          Used on the next corpse or loot roll.
        </p>
      )}
    </div>
  );
}
