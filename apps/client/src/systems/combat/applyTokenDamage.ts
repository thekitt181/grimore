import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { applyTokenHpToCombatants } from '@/systems/initiative/initiativeTokenSync';
import { applyDamage, readTempHp } from '@/systems/initiative/hpUtils';
import { onTokenTookDamageForConcentration } from '@/systems/spells/concentrationManager';
import { maybeSpawnCorpse } from './corpseLoot';

export function applyDamageToToken(tokenId: string, amount: number): void {
  if (amount <= 0) return;
  const item = useItemStore.getState().items[tokenId];
  if (!item || item.type !== 'token') return;

  const { hp, tempHp } = applyDamage(item.hp, readTempHp(item.tempHp), amount);
  if (item.hp === hp && readTempHp(item.tempHp) === tempHp) return;

  const prevHp = item.hp;
  useItemStore.getState().updateItem(tokenId, { hp, tempHp });
  maybeSpawnCorpse(tokenId, prevHp, hp);
  emitItemUpdate([{ id: tokenId, patch: { hp, tempHp } }]);
  applyTokenHpToCombatants(tokenId, { hp, tempHp });
  onTokenTookDamageForConcentration(item, amount, item.ownerId);
}
