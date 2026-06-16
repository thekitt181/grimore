import type { SpellEffectCatalogEntry } from './spellEffectsCatalog';
import {
  formatCastLevel,
  getSpellProjectileScaling,
  scalingSummary,
  spellSupportsLevelScaling,
} from './spellLevelScaling';

const BD = 'var(--color-border)';
const GOLD = 'var(--color-accent-gold)';

export function SpellCastLevelSelect({
  catalog,
  compendiumLevel,
  castLevel,
  onCastLevelChange,
}: {
  catalog?: SpellEffectCatalogEntry;
  compendiumLevel?: number;
  castLevel: number;
  onCastLevelChange: (level: number) => void;
}) {
  const scaling = catalog ? spellSupportsLevelScaling(catalog.id) : false;
  const minLevel = catalog ? (getSpellProjectileScaling(catalog.id)?.baseLevel ?? 0) : 0;

  const summary = catalog ? scalingSummary(catalog, castLevel) : null;

  return (
    <div className="space-y-1">
      <label className="font-ui text-[9px] uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
        Cast at slot level
      </label>
      <select
        value={castLevel}
        onChange={(e) => onCastLevelChange(Number(e.target.value))}
        className="font-ui text-[10px] w-full rounded px-2 py-1"
        style={{
          background: 'var(--color-bg-secondary)',
          border: `1px solid ${BD}`,
          color: 'var(--color-text-primary)',
        }}
      >
        {Array.from({ length: 10 }, (_, i) => i).map((lvl) => {
          if (lvl < minLevel) return null;
          return (
            <option key={lvl} value={lvl}>
              {formatCastLevel(lvl)}
              {compendiumLevel === lvl ? ' (spell level)' : ''}
            </option>
          );
        })}
      </select>
      {summary && (
        <p className="font-ui text-[9px]" style={{ color: GOLD }}>
          {summary}
        </p>
      )}
      {!scaling && compendiumLevel != null && (
        <p className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
          Spell level {formatCastLevel(compendiumLevel)} — no projectile scaling
        </p>
      )}
    </div>
  );
}
