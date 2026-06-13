import { api } from '@/lib/axios';
import type { HandoutRecord, HandoutReceiptRecord, HandoutType, HandoutInventoryTarget } from '@grimoire/shared';

export type HandoutWriteInput = {
  title: string;
  content?: string | null;
  imageUrl?: string | null;
  type?: HandoutType;
  compendiumItemId?: string | null;
  ddbDefinitionId?: number | null;
  itemMeta?: HandoutRecord['itemMeta'];
};

export async function fetchCampaignHandouts(campaignId: string): Promise<HandoutRecord[]> {
  const { data } = await api.get<{ handouts: HandoutRecord[] }>(`/handouts/campaigns/${campaignId}/handouts`);
  return data.handouts;
}

export async function fetchHandoutJournal(campaignId: string): Promise<HandoutReceiptRecord[]> {
  const { data } = await api.get<{ journal: HandoutReceiptRecord[] }>(`/handouts/campaigns/${campaignId}/handout-journal`);
  return data.journal;
}

export async function createCampaignHandout(campaignId: string, input: HandoutWriteInput): Promise<HandoutRecord> {
  const { data } = await api.post<{ handout: HandoutRecord }>(`/handouts/campaigns/${campaignId}/handouts`, input);
  return data.handout;
}

export async function updateCampaignHandout(id: string, input: Partial<HandoutWriteInput>): Promise<HandoutRecord> {
  const { data } = await api.patch<{ handout: HandoutRecord }>(`/handouts/${id}`, input);
  return data.handout;
}

export async function deleteCampaignHandout(id: string): Promise<void> {
  await api.delete(`/handouts/${id}`);
}

export async function revealCampaignHandout(
  id: string,
  sessionId: string,
  targetUserIds: string[] | 'all' = 'all',
): Promise<HandoutReceiptRecord[]> {
  const { data } = await api.post<{ receipts: HandoutReceiptRecord[] }>(`/handouts/${id}/reveal`, {
    sessionId,
    targetUserIds,
  });
  return data.receipts;
}

export type SceneItemHandoutRevealInput = {
  sessionId: string;
  sceneItemId: string;
  title: string;
  content?: string | null;
  imageUrl?: string | null;
  compendiumItemId?: string | null;
  itemMeta?: HandoutRecord['itemMeta'];
  targetUserIds?: string[] | 'all';
  pushToDdb?: {
    ddbCharacterId: number;
    target: HandoutInventoryTarget;
    targetUserId: string;
  };
};

export type SceneItemHandoutRevealResult = {
  receipts: HandoutReceiptRecord[];
  pushResult?: { ok: boolean; mode: string; message: string } | null;
};

export async function revealSceneItemHandout(
  input: SceneItemHandoutRevealInput,
): Promise<SceneItemHandoutRevealResult> {
  const { data } = await api.post<SceneItemHandoutRevealResult>('/handouts/scene-reveal', {
    targetUserIds: 'all',
    ...input,
  });
  return data;
}

export async function gmPushHandoutReceiptToInventory(
  receiptId: string,
  ddbCharacterId: number,
  target: HandoutInventoryTarget = 'character',
): Promise<{ ok: boolean; mode: string; message: string; target?: HandoutInventoryTarget }> {
  const { data } = await api.post<{ ok: boolean; mode: string; message: string; target?: HandoutInventoryTarget }>(
    `/handouts/receipts/${receiptId}/gm-push-inventory`,
    { ddbCharacterId, target },
  );
  return data;
}

export type HandoutInventoryManualFallback = {
  characterUrl: string;
  itemName: string;
  isCustom: boolean;
  target: 'character' | 'party';
};

export async function addHandoutReceiptToInventory(
  receiptId: string,
  ddbCharacterId: number,
  target: HandoutInventoryTarget = 'character',
  description?: string,
): Promise<{
  ok: boolean;
  mode: string;
  message: string;
  target?: HandoutInventoryTarget;
  manualFallback?: HandoutInventoryManualFallback;
}> {
  const { data } = await api.post<{
    ok: boolean;
    mode: string;
    message: string;
    target?: HandoutInventoryTarget;
    manualFallback?: HandoutInventoryManualFallback;
  }>(
    `/handouts/receipts/${receiptId}/add-to-inventory`,
    { ddbCharacterId, target, ...(description?.trim() ? { description: description.trim() } : {}) },
  );
  return data;
}
