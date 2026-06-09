import type { CompendiumSpell } from '@grimoire/shared';
import type { ActionDamage } from './statBlockParser';
import { RollButton } from '@/systems/dice/RollButton';
import { RollableText } from '@/systems/dice/RollableText';
import { AoeTemplateBlock } from '@/systems/combat/AoeTemplateBlock';
import { CasterTokenHint } from '@/systems/combat/CasterTokenHint';
import { SaveAreaEffectBlock } from '@/systems/combat/SaveAreaEffectBlock';
import { useCasterToken } from '@/systems/combat/useCasterToken';
import { hasAoeTemplate } from './statBlockParser';

function spellDamages(spell: CompendiumSpell): ActionDamage[] {
  const out: ActionDamage[] = [];
  if (spell.damage) out.push({ dice: spell.damage, type: spell.type ?? 'damage' });
  if (spell.secondary) out.push({ dice: spell.secondary.damage, type: spell.secondary.type });
  return out;
}

function isSaveAreaCompendiumSpell(spell: CompendiumSpell, damages: ActionDamage[]): boolean {
  return Boolean(spell.save && damages.length > 0 && hasAoeTemplate(spell.aoe) && !spell.attack);
}

export function SpellRollPanel({ spell }: { spell: CompendiumSpell }) {
  const caster = useCasterToken();
  const damages = spellDamages(spell);
  const aoe = spell.aoe;
  const hasAoe = hasAoeTemplate(aoe);
  const isSaveArea = isSaveAreaCompendiumSpell(spell, damages);

  return (
    <div className="space-y-2">
      {hasAoe && aoe && (
        caster ? (
          isSaveArea ? (
            <SaveAreaEffectBlock
              effectName={spell.name}
              token={caster}
              damages={damages}
              aoe={aoe}
              {...(spell.save ? { save: { stat: spell.save } } : {})}
            />
          ) : (
            <AoeTemplateBlock
              effectName={spell.name}
              token={caster}
              aoe={aoe}
              damages={damages}
              {...(spell.save ? { saveStat: spell.save } : {})}
              rollVariant="damage"
            />
          )
        ) : (
          <CasterTokenHint />
        )
      )}

      {!hasAoe && (
        <div className="flex flex-wrap gap-1">
          {damages.map((dmg, i) => (
            <RollButton
              key={`${dmg.dice}-${i}`}
              notation={dmg.dice.replace(/\s+/g, '')}
              label={`${dmg.dice} ${dmg.type}`}
              variant="damage"
            />
          ))}
          {spell.attack && (
            <RollButton notation="1d20" label="Spell Attack (d20)" variant="attack" />
          )}
          {spell.save && (
            <span
              className="font-ui text-xs px-1.5 py-0.5 rounded"
              style={{ border: '1px solid #ef4444', color: '#fca5a5' }}
            >
              {spell.save} save
            </span>
          )}
        </div>
      )}

      {hasAoe && spell.attack && (
        <RollButton notation="1d20" label="Spell Attack (d20)" variant="attack" />
      )}

      {spell.description && (
        <RollableText text={spell.description} className="max-h-48 overflow-y-auto" />
      )}
    </div>
  );
}
