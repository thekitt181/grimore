import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompendiumMonster } from '@grimoire/shared';
import { ActionTabList } from '@/systems/combat/ActionTabList';
import { RollButton } from '@/systems/dice/RollButton';
import { RollableText } from '@/systems/dice/RollableText';
import { searchSpells } from './compendiumApi';
import { cleanStatBlockText } from './actionDetail';
import {
  formatActionDamage,
  buildSpellLookup,
  getMonsterAbilities,
  parseMonsterActions,
  parseSavingThrows,
  type ParsedAction,
} from './statBlockParser';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function actionBody(action: ParsedAction): string {
  const cleaned = cleanStatBlockText(action.originalText);
  const name = action.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleaned.replace(new RegExp(`^${name}\\.?\\s*`, 'i'), '').trim();
}

function ActionUse({ action }: { action: ParsedAction }) {
  const hasButtons =
    action.toHit !== undefined
    || action.damages.length > 0
    || action.spells.length > 0;
  if (!hasButtons && !action.aoe && !action.save) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {action.save && (
        <span className="font-ui text-[10px]" style={{ color: '#fca5a5' }}>
          DC {action.save.dc} {action.save.stat} save
        </span>
      )}
      {action.toHit !== undefined && (
        <RollButton
          notation={`1d20${action.toHit >= 0 ? '+' : ''}${action.toHit}`}
          label={`To Hit ${action.toHit >= 0 ? '+' : ''}${action.toHit}`}
          variant="attack"
        />
      )}
      {action.damages.map((dmg, i) => (
        <RollButton
          key={`${dmg.dice}-${i}`}
          notation={dmg.dice.replace(/\s+/g, '')}
          label={formatActionDamage(dmg)}
          variant="damage"
        />
      ))}
      {action.spells.map((spell, i) =>
        spell.dice ? (
          <RollButton
            key={`${spell.name}-${i}`}
            notation={spell.dice.replace(/\s+/g, '')}
            label={`${spell.name} (${spell.dice.trim()})`}
            variant="spell"
          />
        ) : (
          <span
            key={`${spell.name}-${i}`}
            className="font-ui text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(96,165,250,0.08)', color: '#93c5fd' }}
          >
            {spell.name}{spell.label ? ` [${spell.label}]` : ''}
          </span>
        ),
      )}
      {action.aoe && (
        <span className="font-ui text-xs opacity-70" style={{ color: 'var(--color-text-secondary)' }}>
          {action.aoe.size}ft {action.aoe.type}
        </span>
      )}
    </div>
  );
}

export function MonsterRollPanel({ monster }: { monster: CompendiumMonster }) {
  const { data: spellData } = useQuery({
    queryKey: ['compendium', 'spells', 'lookup'],
    queryFn: () => searchSpells({ limit: 5000 }),
    staleTime: 5 * 60_000,
  });

  const lookup = useMemo(
    () => buildSpellLookup(spellData?.items ?? []),
    [spellData?.items],
  );

  const abilities = useMemo(
    () => getMonsterAbilities(monster.description, monster.stats),
    [monster.description, monster.stats],
  );
  const saves = useMemo(() => parseSavingThrows(monster.description), [monster.description]);
  const actions = useMemo(
    () => parseMonsterActions(monster.description, lookup),
    [monster.description, lookup],
  );

  const listed = useMemo(
    () => actions.filter((action) => {
      const hasButtons =
        action.toHit !== undefined
        || action.damages.length > 0
        || action.spells.length > 0;
      return Boolean(action.save || hasButtons || actionBody(action));
    }),
    [actions],
  );

  const dexMod = abilities.find((a) => a.name === 'DEX')?.mod;

  return (
    <div className="space-y-2">
      {abilities.length > 0 && (
        <div
          className="grid grid-cols-6 gap-1 rounded p-1.5"
          style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
        >
          {abilities.map((ab) => (
            <div key={ab.name} className="text-center space-y-0.5">
              <div className="font-display text-[10px]" style={{ color: GOLD }}>{ab.name}</div>
              <div className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>{ab.score}</div>
              <RollButton
                notation={`1d20${ab.mod >= 0 ? '+' : ''}${ab.mod}`}
                label={`${ab.mod >= 0 ? '+' : ''}${ab.mod}`}
                title={`${ab.name} check`}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {dexMod !== undefined && (
          <RollButton
            notation={`1d20${dexMod >= 0 ? '+' : ''}${dexMod}`}
            label={`Initiative ${dexMod >= 0 ? '+' : ''}${dexMod}`}
            variant="attack"
          />
        )}
        {saves.map((save) => (
          <RollButton
            key={save.name}
            notation={`1d20${save.mod >= 0 ? '+' : ''}${save.mod}`}
            label={`${save.name} ${save.mod >= 0 ? '+' : ''}${save.mod}`}
            title={`${save.name} save`}
          />
        ))}
      </div>

      <ActionTabList
        actions={listed}
        renderUse={(action) => <ActionUse action={action} />}
      />

      {listed.length === 0 && (
        <RollableText text={monster.description} className="max-h-48 overflow-y-auto opacity-80" />
      )}
    </div>
  );
}
