import { api } from '@/lib/axios';
import type { HandoutRecord, HandoutReceiptRecord, HandoutType } from '@grimoire/shared';

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

export async function addHandoutReceiptToInventory(
  receiptId: string,
  ddbCharacterId: number,
): Promise<{ ok: boolean; mode: string; message: string }> {
  const { data } = await api.post<{ ok: boolean; mode: string; message: string }>(
    `/handouts/receipts/${receiptId}/add-to-inventory`,
    { ddbCharacterId },
  );
  return data;
}
