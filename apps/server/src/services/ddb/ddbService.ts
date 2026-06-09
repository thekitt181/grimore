import { prisma } from '../../lib/prisma';
import { decryptToken, encryptToken } from './encryption';
import { normalizeCobaltToken, validateCobalt } from './cobaltAuth';
import { extractCharacter } from './characterExtract';
import { fetchDdbCampaigns, fetchDdbCharacterList } from './campaigns';
import { pushHpToDdb, pushDeathSavesToDdb, type DdbDeathSavesPayload } from './characterUpdate';
import { fetchDdbEncounters } from './encounters';
import { fetchDdbCatalog, fetchDdbSources } from './ddbSources';
import {
  fetchDdbMonsterDetail,
  importDdbLibraryEntries,
  importAllDdbLibraryFromSource,
  importAllDdbLibraryFromSources,
  searchDdbItems,
  searchDdbMonsters,
  searchDdbSpells,
} from './ddbLibrary';
import { enrichMonstersForImport } from './ddbMonsterFetch';
import { getDdbAuthContext } from './ddbAuthContext';
import { normalizeDdbMonsterToCompendium } from './ddbContentNormalize';
import { coerceGrimoireCharacter, type DdbLinkStatus, type GrimoireCharacter } from '@grimoire/shared';
import { DDB_NORMALIZER_VERSION } from './normalizerVersion';

export async function getCobaltForUser(userId: string): Promise<string | null> {
  const conn = await prisma.ddbConnection.findUnique({ where: { userId } });
  if (!conn) return null;
  return decryptToken(conn.cobaltEncrypted);
}

export async function linkDdbAccount(userId: string, cobalt: string): Promise<DdbLinkStatus> {
  const normalized = normalizeCobaltToken(cobalt);
  const valid = await validateCobalt(normalized);
  if (!valid) {
    throw new Error(
      'Invalid Cobalt token — log in at dndbeyond.com, copy only the CobaltSession cookie value (not the name), and paste it immediately',
    );
  }

  const now = new Date();
  await prisma.ddbConnection.upsert({
    where: { userId },
    create: {
      userId,
      cobaltEncrypted: encryptToken(normalized),
      linkedAt: now,
      lastValidatedAt: now,
      rollBridgeEnabled: true,
    },
    update: {
      cobaltEncrypted: encryptToken(normalized),
      lastValidatedAt: now,
    },
  });

  return { linked: true, valid: true, linkedAt: now.toISOString(), lastValidatedAt: now.toISOString() };
}

export async function unlinkDdbAccount(userId: string): Promise<void> {
  await prisma.ddbConnection.deleteMany({ where: { userId } });
  await prisma.ddbCharacterCache.deleteMany({ where: { userId } });
}

export async function getDdbStatus(userId: string): Promise<DdbLinkStatus> {
  const conn = await prisma.ddbConnection.findUnique({ where: { userId } });
  if (!conn) return { linked: false };

  let cobalt: string;
  try {
    cobalt = decryptToken(conn.cobaltEncrypted);
  } catch (err) {
    console.error('[DDB] decrypt failed (wrong encryption key?):', err);
    return { linked: true, valid: false, linkedAt: conn.linkedAt.toISOString() };
  }

  let valid = false;
  try {
    valid = await validateCobalt(cobalt);
  } catch (err) {
    console.error('[DDB] validate failed:', err);
  }
  if (valid && !conn.lastValidatedAt) {
    await prisma.ddbConnection.update({
      where: { userId },
      data: { lastValidatedAt: new Date() },
    });
  }

  return {
    linked: true,
    valid,
    linkedAt: conn.linkedAt.toISOString(),
    lastValidatedAt: (conn.lastValidatedAt ?? conn.linkedAt).toISOString(),
    syncHpToDdb: conn.syncHpToDdb,
    rollBridgeEnabled: conn.rollBridgeEnabled,
  };
}

export async function getOrSyncCharacter(
  userId: string,
  ddbCharacterId: number,
  force = false,
): Promise<GrimoireCharacter> {
  const cobalt = await getCobaltForUser(userId);
  if (!cobalt) throw new Error('D&D Beyond account not linked');

  if (!force) {
    const cached = await prisma.ddbCharacterCache.findUnique({
      where: { userId_ddbCharacterId: { userId, ddbCharacterId } },
    });
    if (cached) {
      const snap = cached.snapshot as Record<string, unknown>;
      const version =
        (snap.ddbNormalizerVersion as number | undefined)
        ?? (snap.hpNormalizerVersion as number | undefined);
      if (version === DDB_NORMALIZER_VERSION) {
        return coerceGrimoireCharacter({
          ...(snap as Partial<GrimoireCharacter>),
          ddbCharacterId,
        });
      }
    }
  }

  const character = await extractCharacter(cobalt, ddbCharacterId);
  const snapshot = { ...character, ddbNormalizerVersion: DDB_NORMALIZER_VERSION };
  await prisma.ddbCharacterCache.upsert({
    where: { userId_ddbCharacterId: { userId, ddbCharacterId } },
    create: {
      userId,
      ddbCharacterId,
      name: character.name,
      campaignId: character.campaignId ?? null,
      snapshot: snapshot as unknown as Parameters<typeof prisma.ddbCharacterCache.create>[0]['data']['snapshot'],
      updateId: character.updateId ?? 0,
      lastSyncedAt: new Date(),
    },
    update: {
      name: character.name,
      campaignId: character.campaignId ?? null,
      snapshot: snapshot as unknown as Parameters<typeof prisma.ddbCharacterCache.update>[0]['data']['snapshot'],
      updateId: character.updateId ?? 0,
      lastSyncedAt: new Date(),
    },
  });

  return coerceGrimoireCharacter(character);
}

export async function patchCharacterHp(
  userId: string,
  ddbCharacterId: number,
  hp: number,
  tempHp: number,
): Promise<{ pushedToDdb: boolean; character: GrimoireCharacter }> {
  const cobalt = await getCobaltForUser(userId);
  if (!cobalt) throw new Error('D&D Beyond account not linked');

  const pushedToDdb = await pushHpToDdb(cobalt, ddbCharacterId, hp, tempHp);

  const cached = await prisma.ddbCharacterCache.findUnique({
    where: { userId_ddbCharacterId: { userId, ddbCharacterId } },
  });

  if (cached) {
    const snap = coerceGrimoireCharacter({
      ...(cached.snapshot as unknown as Partial<GrimoireCharacter>),
      ddbCharacterId,
    });
    const next = coerceGrimoireCharacter({ ...snap, hp, tempHp, lastSyncedAt: new Date().toISOString() });
    await prisma.ddbCharacterCache.update({
      where: { id: cached.id },
      data: {
        snapshot: {
          ...next,
          ddbNormalizerVersion: DDB_NORMALIZER_VERSION,
        } as unknown as Parameters<typeof prisma.ddbCharacterCache.update>[0]['data']['snapshot'],
      },
    });
    return { pushedToDdb, character: next };
  }

  const character = await getOrSyncCharacter(userId, ddbCharacterId, true);
  character.hp = hp;
  character.tempHp = tempHp;
  return { pushedToDdb, character };
}

export async function patchCharacterDeathSaves(
  userId: string,
  ddbCharacterId: number,
  deathSaves: DdbDeathSavesPayload,
  options?: { hp?: number; tempHp?: number },
): Promise<{ pushedToDdb: boolean; character: GrimoireCharacter }> {
  const cobalt = await getCobaltForUser(userId);
  if (!cobalt) throw new Error('D&D Beyond account not linked');

  let pushedToDdb = await pushDeathSavesToDdb(cobalt, ddbCharacterId, deathSaves);

  if (options?.hp != null) {
    const hpPushed = await pushHpToDdb(
      cobalt,
      ddbCharacterId,
      options.hp,
      options.tempHp ?? 0,
    );
    pushedToDdb = pushedToDdb && hpPushed;
  }

  const cached = await prisma.ddbCharacterCache.findUnique({
    where: { userId_ddbCharacterId: { userId, ddbCharacterId } },
  });

  if (cached) {
    const snap = coerceGrimoireCharacter({
      ...(cached.snapshot as unknown as Partial<GrimoireCharacter>),
      ddbCharacterId,
    });
    const next = coerceGrimoireCharacter({
      ...snap,
      deathSaves: {
        successes: deathSaves.successes,
        failures: deathSaves.failures,
        stabilized: deathSaves.stabilized,
      },
      ...(options?.hp != null ? { hp: options.hp } : {}),
      ...(options?.tempHp != null ? { tempHp: options.tempHp } : {}),
      lastSyncedAt: new Date().toISOString(),
    });
    await prisma.ddbCharacterCache.update({
      where: { id: cached.id },
      data: {
        snapshot: {
          ...next,
          ddbNormalizerVersion: DDB_NORMALIZER_VERSION,
        } as unknown as Parameters<typeof prisma.ddbCharacterCache.update>[0]['data']['snapshot'],
      },
    });
    return { pushedToDdb, character: next };
  }

  const character = await getOrSyncCharacter(userId, ddbCharacterId, true);
  character.deathSaves = {
    successes: deathSaves.successes,
    failures: deathSaves.failures,
    stabilized: deathSaves.stabilized,
  };
  if (options?.hp != null) character.hp = options.hp;
  if (options?.tempHp != null) character.tempHp = options.tempHp;
  return { pushedToDdb, character };
}

async function requireDdbAuth(userId: string) {
  const cobalt = await getCobaltForUser(userId);
  if (!cobalt) throw new Error('D&D Beyond account not linked');
  const ctx = await getDdbAuthContext(cobalt);
  if (!ctx) throw new Error('Invalid or expired D&D Beyond session — re-link your Cobalt token');
  return ctx;
}

export async function listDdbLibrarySources(userId: string) {
  const ctx = await requireDdbAuth(userId);
  return fetchDdbSources(ctx);
}

export async function browseDdbLibraryMonsters(
  userId: string,
  opts: { q?: string; sourceId?: number; sourceIds?: number[]; skip?: number; take?: number },
) {
  const ctx = await requireDdbAuth(userId);
  return searchDdbMonsters(ctx, opts);
}

export async function previewDdbLibraryMonster(userId: string, ddbId: number) {
  const ctx = await requireDdbAuth(userId);
  const catalog = await fetchDdbCatalog(ctx);
  const raw = await fetchDdbMonsterDetail(ctx, ddbId);
  if (!raw) throw new Error('Monster not found');
  const [enriched] = await enrichMonstersForImport(ctx, [raw]);
  const entry = normalizeDdbMonsterToCompendium(enriched ?? raw, catalog);
  if (!entry) throw new Error('Could not parse monster');
  return entry;
}

export async function browseDdbLibrarySpells(
  userId: string,
  opts: { q?: string; sourceId?: number; sourceIds?: number[]; campaignId?: number; limit?: number },
) {
  const ctx = await requireDdbAuth(userId);
  return searchDdbSpells(ctx, opts);
}

export async function browseDdbLibraryItems(
  userId: string,
  opts: { q?: string; sourceId?: number; sourceIds?: number[]; campaignId?: number; limit?: number },
) {
  const ctx = await requireDdbAuth(userId);
  return searchDdbItems(ctx, opts);
}

export async function importFromDdbLibrary(
  userId: string,
  opts: { kind: 'monster' | 'item' | 'spell'; ids: number[]; campaignId?: number; sourceId?: number },
) {
  const ctx = await requireDdbAuth(userId);
  return importDdbLibraryEntries(ctx, opts);
}

export async function importAllFromDdbLibrarySource(
  userId: string,
  opts: { sourceId?: number; sourceIds?: number[]; campaignId?: number },
) {
  const ctx = await requireDdbAuth(userId);
  const sourceIds = opts.sourceIds?.length
    ? opts.sourceIds
    : opts.sourceId
      ? [opts.sourceId]
      : [];
  return importAllDdbLibraryFromSources(ctx, {
    sourceIds,
    campaignId: opts.campaignId,
  });
}

export { fetchDdbCampaigns, fetchDdbCharacterList, fetchDdbEncounters };
