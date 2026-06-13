import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { HandoutItem } from '@/systems/scene/types';
import type { HandoutInventoryTarget, HandoutReceiptRecord } from '@grimoire/shared';
import { revealSceneItemHandout } from '@/systems/handouts/handoutApi';
import { useHandoutJournalStore } from '@/systems/handouts/handoutJournalStore';
import { useSessionStore } from '@/store/sessionStore';

export interface RevealHandoutOptions {
  targetUserIds?: string[] | 'all';
  pushToDdb?: {
    ddbCharacterId: number;
    target: HandoutInventoryTarget;
    targetUserId: string;
  };
}

export interface RevealHandoutResult {
  receipts: HandoutReceiptRecord[];
  pushResult?: { ok: boolean; mode: string; message: string } | null;
}

function refreshJournalAfterReveal(receipts: HandoutReceiptRecord[]): void {
  const { campaignId, myUserId } = useSessionStore.getState();
  const journal = useHandoutJournalStore.getState();
  for (const receipt of receipts) {
    if (receipt.userId === myUserId) journal.upsertEntry(receipt);
  }
  if (campaignId) void journal.loadJournal(campaignId);
}

function buildItemMeta(handout: HandoutItem) {
  return {
    name: handout.name,
    ...(handout.itemType ? { itemType: handout.itemType } : {}),
    ...(handout.rarity ? { rarity: handout.rarity } : {}),
    ...(handout.source ? { source: handout.source } : {}),
    compendiumItemId: handout.compendiumItemId,
    sceneItemId: handout.id,
  };
}

export async function revealHandoutToPlayers(
  handout: HandoutItem,
  sessionId: string,
  opts?: RevealHandoutOptions,
): Promise<RevealHandoutResult> {
  if (!handout.visible) {
    useItemStore.getState().updateItem(handout.id, { visible: true });
    emitItemUpdate([{ id: handout.id, patch: { visible: true } }]);
  }

  const result = await revealSceneItemHandout({
    sessionId,
    sceneItemId: handout.id,
    title: handout.name,
    content: handout.description,
    compendiumItemId: handout.compendiumItemId,
    itemMeta: buildItemMeta(handout),
    ...(handout.imageUrl ? { imageUrl: handout.imageUrl } : {}),
    targetUserIds: opts?.targetUserIds ?? 'all',
    ...(opts?.pushToDdb ? { pushToDdb: opts.pushToDdb } : {}),
  });
  refreshJournalAfterReveal(result.receipts);
  return result;
}
