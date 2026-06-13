import { Prisma, type Handout, type HandoutReceipt, type HandoutType } from '@prisma/client';
import type { HandoutItemMeta, HandoutRecord, HandoutReceiptRecord } from '@grimoire/shared';
import { prisma } from '../lib/prisma';

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
  const campaign = await prisma.campaign.findUnique({
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
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { gmId: true },
  });
  return campaign?.gmId === userId;
}

export async function listCampaignHandouts(campaignId: string): Promise<HandoutRecord[]> {
  const rows = await prisma.handout.findMany({
    where: { campaignId },
    orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
  });
  return rows.map(serializeHandout);
}

export async function listUserHandoutJournal(userId: string, campaignId: string): Promise<HandoutReceiptRecord[]> {
  const rows = await prisma.handoutReceipt.findMany({
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
  const row = await prisma.handout.create({
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
  const existing = await prisma.handout.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.handout.update({
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
    await prisma.handout.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function getHandout(id: string): Promise<HandoutRecord | null> {
  const row = await prisma.handout.findUnique({ where: { id } });
  return row ? serializeHandout(row) : null;
}

export async function getReceipt(id: string): Promise<HandoutReceiptRecord | null> {
  const row = await prisma.handoutReceipt.findUnique({ where: { id } });
  return row ? serializeReceipt(row) : null;
}

export async function resolveRevealTargets(
  sessionId: string,
  targetUserIds: string[] | 'all',
): Promise<string[]> {
  if (targetUserIds !== 'all') {
    return [...new Set(targetUserIds.filter(Boolean))];
  }
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      campaign: {
        select: {
          gmId: true,
          members: { select: { userId: true } },
        },
      },
    },
  });
  if (!session) return [];
  const ids = session.campaign.members.map((m) => m.userId);
  return [...new Set(ids.filter((id) => id !== session.campaign.gmId))];
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
    const row = await prisma.handoutReceipt.upsert({
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
