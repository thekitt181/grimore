import type { TokenItem } from '@/systems/scene/types';
import {
  formatActionDamage,
  hasAoeTemplate,
  isSaveAreaAction,
  type ParsedAction,
} from '@/systems/compendium/statBlockParser';
import { RollButton } from '@/systems/dice/RollButton';
import { AoeTemplateBlock } from './AoeTemplateBlock';
import { SaveAreaEffectBlock } from './SaveAreaEffectBlock';
import { TargetedAttackButton } from './TargetedAttackButton';
import { CastSpellEffectButton } from '@/systems/spells/CastSpellEffectButton';
import { formatActionRangeLabel } from './attackRange';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export function TokenActionCard({
  action,
  token,
  isActivePick,
  compact = false,
  onShowDetails,
}: {
  action: ParsedAction;
  token: TokenItem;
  isActivePick: boolean;
  compact?: boolean;
  /** Opens a floating detail panel (features / traits). */
  onShowDetails?: () => void;
}) {
  const isSaveArea = isSaveAreaAction(action);
  const hasRolls =
    action.toHit !== undefined || action.damages.length > 0 || action.spells.some((s) => s.dice) || isSaveArea;

  if (!hasRolls) {
    const description = action.originalText !== action.name ? action.originalText : undefined;
    const clickable = Boolean(onShowDetails);
    return (
      <div
        className="rounded overflow-hidden space-y-1 px-2 py-1.5"
        style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
      >
        {clickable ? (
          <button
            type="button"
            className="w-full text-left hover:opacity-90 transition-opacity"
            onClick={onShowDetails}
            title="View details"
          >
            <span className="font-display text-[10px]" style={{ color: GOLD }}>
              {action.name}
              <span className="font-ui ml-1 opacity-60" style={{ fontSize: 8 }}>▸</span>
            </span>
          </button>
        ) : (
          <span className="font-display text-[10px]" style={{ color: GOLD }}>{action.name}</span>
        )}
        <CastSpellEffectButton
          spellName={action.name}
          token={token}
          {...(action.aoe ? { aoe: action.aoe } : {})}
          {...(description ? { description } : {})}
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} space-y-1.5 transition-all`}
      style={{
        background: isActivePick ? 'rgba(201,168,76,0.1)' : 'var(--color-bg-primary)',
        border: `1px solid ${isActivePick ? GOLD : BD}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`font-display ${compact ? 'text-[10px]' : 'text-xs'} leading-tight block`} style={{ color: GOLD }}>
            {action.name}
          </span>
          {action.range && action.range.kind !== 'unknown' && (
            <span className="font-ui text-[9px] block mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              {formatActionRangeLabel(action.range)}
            </span>
          )}
        </div>
        {action.save && (
          <span className="font-ui text-[9px] shrink-0 px-1 py-0.5 rounded" style={{ color: '#fca5a5', border: '1px solid #ef4444' }}>
            DC {action.save.dc} {action.save.stat}
          </span>
        )}
      </div>

      {action.toHit !== undefined && (
        <div className="space-y-1">
          <TargetedAttackButton
            attackerTokenId={token.id}
            attackerName={token.name}
            actionName={action.name}
            toHit={action.toHit}
            damages={action.damages}
            {...(action.range !== undefined ? { range: action.range } : {})}
            className="w-full text-center py-1"
          />
          {action.damages.length > 0 && (
            <p className="font-ui text-[9px] text-center" style={{ color: 'var(--color-text-secondary)' }}>
              On hit: {action.damages.map((d) => formatActionDamage(d)).join(', ')}
            </p>
          )}
        </div>
      )}

      {isSaveArea && action.aoe && (
        <SaveAreaEffectBlock
          effectName={action.name}
          token={token}
          damages={action.damages}
          aoe={action.aoe}
          save={{ dc: action.save!.dc, stat: action.save!.stat }}
          {...(action.originalText !== action.name ? { description: action.originalText } : {})}
        />
      )}

      {!isSaveArea && !hasAoeTemplate(action.aoe) && action.toHit === undefined && action.damages.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {action.damages.map((dmg, i) => (
            <RollButton
              key={`${dmg.dice}-${i}`}
              notation={dmg.dice.replace(/\s+/g, '')}
              label={formatActionDamage(dmg)}
              variant="damage"
            />
          ))}
        </div>
      )}

      {action.spells.map((spell, i) =>
        spell.dice ? (
          <RollButton
            key={`${spell.name}-${i}`}
            notation={spell.dice.replace(/\s+/g, '')}
            label={spell.name}
            variant="spell"
          />
        ) : null,
      )}

      {hasAoeTemplate(action.aoe) && !isSaveArea && (
        <AoeTemplateBlock
          effectName={action.name}
          token={token}
          aoe={action.aoe!}
          damages={action.damages}
          rollVariant="damage"
        />
      )}
    </div>
  );
}
