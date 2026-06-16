import type { TokenItem } from '@/systems/scene/types';
import { findSpellEffectCatalogEntry } from './spellEffectsCatalog';
import { SpellEffectCastControls } from './SpellEffectCastControls';

export function CastSpellEffectButton({
  spellName,
  token,
  concentration,
  description,
  aoe,
}: {
  spellName: string;
  token: TokenItem;
  concentration?: boolean;
  description?: string;
  aoe?: { size: number; type: string };
}) {
  const catalog = findSpellEffectCatalogEntry(spellName);
  const effectiveAoe = aoe ?? catalog?.aoe;

  return (
    <SpellEffectCastControls
      casterToken={token}
      spellName={spellName}
      {...(catalog ? { catalog } : {})}
      {...(concentration !== undefined ? { concentration } : {})}
      {...(description ? { description } : {})}
      {...(effectiveAoe ? { aoe: effectiveAoe } : {})}
      compact
    />
  );
}
