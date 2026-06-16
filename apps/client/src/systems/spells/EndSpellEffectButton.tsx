import { aoeActionNamesMatch } from '@/systems/combat/aoePlacementUtils';
import { useSpellEffectStore } from './effectStore';
import { endSpellEffect } from './castSpellEffect';

const BD = 'var(--color-border)';

/** Ends the active map effect for this caster + spell name. */
export function EndSpellEffectButton({
  spellName,
  casterTokenId,
  className = '',
}: {
  spellName: string;
  casterTokenId: string;
  className?: string;
}) {
  const effect = useSpellEffectStore((s) =>
    s.effects.find(
      (e) =>
        !e.ended
        && e.casterTokenId === casterTokenId
        && aoeActionNamesMatch(e.spellName, spellName),
    ),
  );

  if (!effect) return null;

  return (
    <button
      type="button"
      onClick={() => endSpellEffect(effect.id, 'manual')}
      className={`font-ui text-[10px] px-2 py-1 rounded transition-all hover:opacity-90 ${className}`.trim()}
      style={{
        border: `1px solid ${BD}`,
        color: 'var(--color-text-secondary)',
      }}
    >
      End spell
    </button>
  );
}
