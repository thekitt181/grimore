import { Prisma, type Handout, type HandoutReceipt, type HandoutType } from '@prisma/client';
import type { HandoutItemMeta, HandoutRecord, HandoutReceiptRecord } from '@grimoire/shared';
import { readPrisma } from '../lib/prisma';

function parseItemMeta(raw: unknown): HandoutItemMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as HandoutItemMeta;
}

export function serializeHandout(row: Handout): HandoutRecord {
  return {
    id: row.id,
    campaignId: row.campaignId,
    title: row.title,
    content: row.content,
    imageUrl: row.imageUrl,
    type: row.type as HandoutRecord['type'],
    compendiumItemId: row.compendiumItemId,
    ddbDefinitionId: row.ddbDefinitionId,
    itemMeta: parseItemMeta(row.itemMeta),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeReceipt(row: HandoutReceipt): HandoutReceiptRecord {
  return {
    id: row.id,
    handoutId: row.handoutId,
    userId: row.userId,
    sessionId: row.sessionId,
    title: row.title,
    content: row.content,
    imageUrl: row.imageUrl,
    type: row.type as HandoutReceiptRecord['type'],
    itemMeta: parseItemMeta(row.itemMeta),
    compendiumItemId: row.compendiumItemId,
    ddbDefinitionId: row.ddbDefinitionId,
    receivedAt: row.receivedAt.toISOString(),
  };
}

export async function assertCampaignMember(campaignId: string, userId: string): Promise<{ isGM: boolean } | null> {
  const campaign = await readPrisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      gmId: true,
      members: { where: { userId }, select: { userId: true } },
    },
  });
  if (!campaign) return null;
  if (campaign.gmId === userId) return { isGM: true };
  if (campaign.members.length > 0) return { isGM: false };
  return null;
}

export async function assertCampaignGM(campaignId: string, userId: string): Promise<boolean> {
  const campaign = await readPrisma.campaign.findUnique({
    where: { id: campaignId },
    select: { gmId: true },
  });
  return campaign?.gmId === userId;
}

export async function listCampaignHandouts(campaignId: string): Promise<HandoutRecord[]> {
  const rows = await readPrisma.handout.findMany({
    where: { campaignId },
    orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
  });
  return rows.map(serializeHandout);
}

export async function listUserHandoutJournal(userId: string, campaignId: string): Promise<HandoutReceiptRecord[]> {
  const rows = await readPrisma.handoutReceipt.findMany({
    where: {
      userId,
      handout: { campaignId },
    },
    orderBy: { receivedAt: 'desc' },
  });
  return rows.map(serializeReceipt);
}

export type HandoutWriteInput = {
  title: string;
  content?: string | null;
  imageUrl?: string | null;
  type?: HandoutType;
  compendiumItemId?: string | null;
  ddbDefinitionId?: number | null;
  itemMeta?: HandoutItemMeta | null;
};

export async function createHandout(campaignId: string, input: HandoutWriteInput): Promise<HandoutRecord> {
  const row = await readPrisma.handout.create({
    data: {
      campaignId,
      title: input.title,
      content: input.content ?? null,
      imageUrl: input.imageUrl ?? null,
      type: input.type ?? 'TEXT',
      compendiumItemId: input.compendiumItemId ?? null,
      ddbDefinitionId: input.ddbDefinitionId ?? null,
      itemMeta: (input.itemMeta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  return serializeHandout(row);
}

export async function updateHandout(id: string, input: Partial<HandoutWriteInput>): Promise<HandoutRecord | null> {
  const existing = await readPrisma.handout.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await readPrisma.handout.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.compendiumItemId !== undefined ? { compendiumItemId: input.compendiumItemId } : {}),
      ...(input.ddbDefinitionId !== undefined ? { ddbDefinitionId: input.ddbDefinitionId } : {}),
      ...(input.itemMeta !== undefined
        ? { itemMeta: input.itemMeta === null ? Prisma.JsonNull : (input.itemMeta as Prisma.InputJsonValue) }
        : {}),
    },
  });
  return serializeHandout(row);
}

export async function deleteHandout(id: string): Promise<boolean> {
  try {
    await readPrisma.handout.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function getHandout(id: string): Promise<HandoutRecord | null> {
  const row = await readPrisma.handout.findUnique({ where: { id } });
  return row ? serializeHandout(row) : null;
}

export async function getReceipt(id: string): Promise<HandoutReceiptRecord | null> {
  const row = await readPrisma.handoutReceipt.findUnique({ where: { id } });
  return row ? serializeReceipt(row) : null;
}

export async function resolveRevealTargets(
  sessionId: string,
  targetUserIds: string[] | 'all',
  opts?: { connectedPlayerIds?: string[] },
): Promise<string[]> {
  if (targetUserIds !== 'all') {
    return [...new Set(targetUserIds.filter(Boolean))];
  }
  const session = await readPrisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      campaign: {
        select: {
          gmId: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  if (!session) return [];

  const gmId = session.campaign.gmId;
  let ids = session.campaign.members
    .filter((m) => m.userId !== gmId && m.role === 'PLAYER')
    .map((m) => m.userId);

  if (ids.length === 0 && opts?.connectedPlayerIds?.length) {
    ids = opts.connectedPlayerIds.filter((id) => id !== gmId);
  }

  // Solo prep or no roster yet — GM still gets a journal entry for testing.
  if (ids.length === 0) {
    ids = [gmId];
  }

  return [...new Set(ids.filter(Boolean))];
}

export type SceneHandoutRevealInput = {
  campaignId: string;
  sceneItemId: string;
  title: string;
  content?: string | null;
  imageUrl?: string | null;
  compendiumItemId?: string | null;
  ddbDefinitionId?: number | null;
  itemMeta?: HandoutItemMeta | null;
};

export async function findHandoutBySceneItemId(
  campaignId: string,
  sceneItemId: string,
): Promise<HandoutRecord | null> {
  const rows = await readPrisma.handout.findMany({
    where: { campaignId, type: 'ITEM_CARD' },
    orderBy: { updatedAt: 'desc' },
  });
  for (const row of rows) {
    const meta = parseItemMeta(row.itemMeta);
    if (meta?.sceneItemId === sceneItemId) return serializeHandout(row);
  }
  return null;
}

export async function upsertSceneItemHandout(input: SceneHandoutRevealInput): Promise<HandoutRecord> {
  const itemMeta: HandoutItemMeta = {
    ...(input.itemMeta ?? {}),
    sceneItemId: input.sceneItemId,
    ...(input.compendiumItemId ? { compendiumItemId: input.compendiumItemId } : {}),
  };

  const existing = await findHandoutBySceneItemId(input.campaignId, input.sceneItemId);
  if (existing) {
    const updated = await updateHandout(existing.id, {
      title: input.title,
      content: input.content,
      imageUrl: input.imageUrl,
      type: 'ITEM_CARD',
      compendiumItemId: input.compendiumItemId,
      ddbDefinitionId: input.ddbDefinitionId,
      itemMeta,
    });
    return updated ?? existing;
  }

  return createHandout(input.campaignId, {
    title: input.title,
    content: input.content,
    imageUrl: input.imageUrl,
    type: 'ITEM_CARD',
    compendiumItemId: input.compendiumItemId,
    ddbDefinitionId: input.ddbDefinitionId,
    itemMeta,
  });
}

export async function revealHandoutToUsers(opts: {
  handout: HandoutRecord;
  sessionId: string;
  targetUserIds: string[];
}): Promise<HandoutReceiptRecord[]> {
  const { handout, sessionId, targetUserIds } = opts;
  if (targetUserIds.length === 0) return [];

  const receipts: HandoutReceiptRecord[] = [];
  for (const userId of targetUserIds) {
    const row = await readPrisma.handoutReceipt.upsert({
      where: { handoutId_userId: { handoutId: handout.id, userId } },
      create: {
        handoutId: handout.id,
        userId,
        sessionId,
        title: handout.title,
        content: handout.content,
        imageUrl: handout.imageUrl,
        type: handout.type,
        itemMeta: (handout.itemMeta ?? undefined) as Prisma.InputJsonValue | undefined,
        compendiumItemId: handout.compendiumItemId,
        ddbDefinitionId: handout.ddbDefinitionId,
      },
      update: {
        sessionId,
        title: handout.title,
        content: handout.content,
        imageUrl: handout.imageUrl,
        type: handout.type,
        itemMeta: (handout.itemMeta ?? undefined) as Prisma.InputJsonValue | undefined,
        compendiumItemId: handout.compendiumItemId,
        ddbDefinitionId: handout.ddbDefinitionId,
        receivedAt: new Date(),
      },
    });
    receipts.push(serializeReceipt(row));
  }
  return receipts;
}
