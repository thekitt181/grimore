import { useMemo, useState } from 'react';
import type { TokenItem } from '@/systems/scene/types';
import {
  formatActionDamage,
  hasAoeTemplate,
  isSaveAreaSpell,
  spellEffectName,
  type ActionDamage,
  type ActionSpell,
  type ParsedAction,
  type SpellLookup,
  type SpellLookupData,
} from '@/systems/compendium/statBlockParser';
import { RollButton } from '@/systems/dice/RollButton';
import { AoeTemplateBlock } from './AoeTemplateBlock';
import { SaveAreaEffectBlock } from './SaveAreaEffectBlock';
import { TargetedAttackButton } from './TargetedAttackButton';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

const RANGED_SPELL: NonNullable<ParsedAction['range']> = {
  kind: 'ranged',
  reachFt: 5,
  rangeNormalFt: 120,
};

function damagesForSpell(spell: ActionSpell, data?: SpellLookupData): ActionDamage[] {
  const out: ActionDamage[] = [];
  const inline = spell.dice?.replace(/\s+/g, '');
  if (inline) out.push({ dice: inline, type: data?.type ?? 'damage' });
  else if (data?.damage) out.push({ dice: data.damage, type: data?.type ?? 'damage' });
  if (data?.secondary) out.push({ dice: data.secondary.damage, type: data.secondary.type });
  return out;
}

function isCombatRosterSpell(spell: ActionSpell, block: ParsedAction, lookup: SpellLookup): boolean {
  const data = lookup(spell.name);
  const damages = damagesForSpell(spell, data);
  if (data?.attack && block.toHit !== undefined) return true;
  if (damages.length > 0) return true;
  if (data?.save && block.save) return true;
  return false;
}

function SpellRosterRow({
  spell,
  block,
  token,
  lookup,
}: {
  spell: ActionSpell;
  block: ParsedAction;
  token: TokenItem;
  lookup: SpellLookup;
}) {
  const data = lookup(spell.name);
  const damages = damagesForSpell(spell, data);
  const hasSave = Boolean(data?.save && block.save);
  const isAttack = Boolean(data?.attack || (block.toHit !== undefined && damages.length > 0 && !hasSave));
  const aoe = spell.aoe ?? data?.aoe;
  const isSaveArea = isSaveAreaSpell(spell, data, {
    hasSave,
    hasAttack: isAttack,
    damages,
  });
  const hasAoe = hasAoeTemplate(aoe);
  const effectName = spellEffectName(spell);

  return (
    <div
      className="rounded px-1.5 py-1 space-y-1"
      style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
    >
      <p className="font-display text-[10px]" style={{ color: GOLD }}>
        {spell.name}
        {spell.label ? <span className="font-ui opacity-60"> · {spell.label}</span> : null}
      </p>

      {isAttack && block.toHit !== undefined && damages.length > 0 && (
        <div className="space-y-1">
          <TargetedAttackButton
            attackerTokenId={token.id}
            attackerName={token.name}
            actionName={spell.name}
            toHit={block.toHit}
            damages={damages}
            range={RANGED_SPELL}
            className="w-full text-center py-1"
          />
          <p className="font-ui text-[9px] text-center" style={{ color: 'var(--color-text-secondary)' }}>
            On hit: {damages.map((d) => formatActionDamage(d)).join(', ')}
          </p>
        </div>
      )}

      {isSaveArea && aoe && block.save && (
        <SaveAreaEffectBlock
          effectName={effectName}
          token={token}
          damages={damages}
          aoe={aoe}
          save={{ dc: block.save.dc, stat: data!.save! }}
        />
      )}

      {!isSaveArea && hasAoe && aoe && (
        <AoeTemplateBlock
          effectName={effectName}
          token={token}
          aoe={aoe}
          damages={damages}
          {...(hasSave && data?.save ? { saveStat: data.save } : {})}
        />
      )}

      {!isSaveArea && !hasAoe && (!isAttack || block.toHit === undefined || damages.length === 0) && damages.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {damages.map((dmg, i) => (
            <RollButton
              key={`${dmg.dice}-${i}`}
              notation={dmg.dice.replace(/\s+/g, '')}
              label={formatActionDamage(dmg)}
              variant="spell"
            />
          ))}
        </div>
      )}

      {hasSave && block.save && !isSaveArea && !hasAoe && (
        <span
          className="font-ui text-[9px] inline-block px-1 py-0.5 rounded"
          style={{ border: '1px solid #ef4444', color: '#fca5a5' }}
        >
          DC {block.save.dc} {data!.save} save
        </span>
      )}

      {!isAttack && damages.length === 0 && !hasSave && (
        <p className="font-ui text-[9px] opacity-70" style={{ color: 'var(--color-text-secondary)' }}>
          Utility — apply effect manually
        </p>
      )}
    </div>
  );
}

export function SpellcastingCard({
  block,
  token,
  lookup,
}: {
  block: ParsedAction;
  token: TokenItem;
  lookup: SpellLookup;
}) {
  const [otherSpell, setOtherSpell] = useState('');

  const { combatSpells, utilitySpells } = useMemo(() => {
    const combat: ActionSpell[] = [];
    const utility: ActionSpell[] = [];
    for (const spell of block.spells) {
      if (isCombatRosterSpell(spell, block, lookup)) combat.push(spell);
      else utility.push(spell);
    }
    return { combatSpells: combat, utilitySpells: utility };
  }, [block, lookup]);

  const picked = block.spells.find((s) => s.name === otherSpell);

  return (
    <div
      className="rounded px-2 py-1.5 space-y-1.5"
      style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-display text-xs leading-tight block" style={{ color: GOLD }}>
            {block.name}
          </span>
          {block.toHit !== undefined && (
            <span className="font-ui text-[9px] block mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Spell attack {block.toHit >= 0 ? '+' : ''}{block.toHit} · range 120 ft
            </span>
          )}
        </div>
        {block.save && (
          <span
            className="font-ui text-[9px] shrink-0 px-1 py-0.5 rounded"
            style={{ color: '#fca5a5', border: '1px solid #ef4444' }}
          >
            DC {block.save.dc}
          </span>
        )}
      </div>

      {combatSpells.length > 0 && (
        <div className="space-y-1">
          <p className="font-ui text-[9px] uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
            Spell attacks &amp; saves ({combatSpells.length})
          </p>
          {combatSpells.map((spell) => (
            <SpellRosterRow
              key={`${spell.name}-${spell.label ?? ''}`}
              spell={spell}
              block={block}
              token={token}
              lookup={lookup}
            />
          ))}
        </div>
      )}

      {block.spells.length === 0 && (
        <p className="font-ui text-[9px] opacity-70" style={{ color: 'var(--color-text-secondary)' }}>
          No spells parsed from this stat block
        </p>
      )}

      {block.spells.length > 0 && (
        <div className="space-y-1">
          <label className="font-ui text-[9px] block" style={{ color: 'var(--color-text-secondary)' }}>
            {utilitySpells.length > 0 ? `Other spells (${utilitySpells.length})` : `All spells (${block.spells.length})`}
          </label>
          <select
            value={otherSpell}
            onChange={(e) => setOtherSpell(e.target.value)}
            className="font-ui text-[10px] w-full rounded px-2 py-1"
            style={{
              background: 'var(--color-bg-primary)',
              border: `1px solid ${BD}`,
              color: 'var(--color-text-primary)',
            }}
          >
            <option value="">Select spell…</option>
            {(utilitySpells.length > 0 ? utilitySpells : block.spells).map((s) => (
              <option key={`${s.name}-${s.label ?? ''}`} value={s.name}>
                {s.name}
                {s.label ? ` · ${s.label}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {picked && !combatSpells.some((s) => s.name === picked.name) && (
        <SpellRosterRow spell={picked} block={block} token={token} lookup={lookup} />
      )}
    </div>
  );
}
