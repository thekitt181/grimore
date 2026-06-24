import { readPrisma } from '../../lib/prisma';
import type { Prisma } from '@prisma/client';
import { decryptToken, encryptToken } from './encryption';
import { normalizeCobaltToken, validateCobalt } from './cobaltAuth';
import { extractCharacter, fetchRawCharacter } from './characterExtract';
import { fetchDdbCampaigns, fetchDdbCharacterList } from './campaigns';
import { pushHpToDdb, pushDeathSavesToDdb, type DdbDeathSavesPayload } from './characterUpdate';
import { fetchDdbEncounters, resolveDdbEncounter, parseDdbEncounterId } from './encounters';
import { fetchDdbCatalog } from './ddbSources';
import { filterAccessibleSourceIds, invalidateAccessibleSourceCache, listAccessibleDdbSources } from './ddbAccessibleSources';
import {
  fetchDdbMonsterDetail,
  importDdbLibraryEntries,
  importAllDdbLibraryFromSource,
  importAllDdbLibraryFromSources,
  finishDdbLibraryImport,
  searchDdbItems,
  searchDdbMonsters,
  searchDdbSpells,
} from './ddbLibrary';
import { enrichMonstersForImport } from './ddbMonsterFetch';
import { getDdbAuthContext } from './ddbAuthContext';
import { normalizeDdbMonsterToCompendium } from './ddbContentNormalize';
import { coerceGrimoireCharacter, DDB_HOMEBREW_SOURCE_ID, type DdbLinkStatus, type GrimoireCharacter } from '@grimoire/shared';
import { DDB_NORMALIZER_VERSION } from './normalizerVersion';

export async function getCobaltForUser(userId: string): Promise<string | null> {
  const conn = await readPrisma.ddbConnection.findUnique({ where: { userId } });
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
  await readPrisma.ddbConnection.upsert({
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

  const ctx = await getDdbAuthContext(normalized);
  if (ctx) invalidateAccessibleSourceCache(ctx.cacheId);

  return { linked: true, valid: true, linkedAt: now.toISOString(), lastValidatedAt: now.toISOString() };
}

export async function unlinkDdbAccount(userId: string): Promise<void> {
  await readPrisma.ddbConnection.deleteMany({ where: { userId } });
  await readPrisma.ddbCharacterCache.deleteMany({ where: { userId } });
}

export async function getDdbStatus(userId: string): Promise<DdbLinkStatus> {
  const conn = await readPrisma.ddbConnection.findUnique({ where: { userId } });
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
    await readPrisma.ddbConnection.update({
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

async function loadCachedCharacter(
  cacheUserIds: string[],
  ddbCharacterId: number,
): Promise<GrimoireCharacter | null> {
  for (const cacheUserId of cacheUserIds) {
    const cached = await readPrisma.ddbCharacterCache.findUnique({
      where: { userId_ddbCharacterId: { userId: cacheUserId, ddbCharacterId } },
    });
    if (!cached) continue;

    const snap = cached.snapshot as Record<string, unknown>;
    const version =
      (snap.ddbNormalizerVersion as number | undefined)
      ?? (snap.hpNormalizerVersion as number | undefined);
    if (version !== DDB_NORMALIZER_VERSION) continue;

    return coerceGrimoireCharacter({
      ...(snap as Partial<GrimoireCharacter>),
      ddbCharacterId,
    });
  }
  return null;
}

/** Players without DDB linked use the campaign GM's connection + cache when in a live session. */
async function resolveDdbProviderUserId(
  userId: string,
  sessionId?: string,
): Promise<string> {
  if (await getCobaltForUser(userId)) return userId;

  if (!sessionId) {
    throw new Error('D&D Beyond account not linked');
  }

  const session = await readPrisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      campaignId: true,
      campaign: { select: { gmId: true } },
    },
  });
  if (!session) throw new Error('Session not found');

  const member = await readPrisma.campaignMember.findFirst({
    where: { campaignId: session.campaignId, userId },
  });
  if (!member) throw new Error('Session access required');

  const gmId = session.campaign.gmId;
  if (!(await getCobaltForUser(gmId))) {
    throw new Error('GM has not linked D&D Beyond — ask your GM to connect in Account settings');
  }

  return gmId;
}

export async function getOrSyncCharacter(
  userId: string,
  ddbCharacterId: number,
  force = false,
  sessionId?: string,
): Promise<GrimoireCharacter> {
  const providerId = await resolveDdbProviderUserId(userId, sessionId);
  const cacheUserIds = providerId === userId ? [userId] : [providerId, userId];

  if (force) {
    // Delete all existing cache entries for this character to ensure fresh sync
    await readPrisma.ddbCharacterCache.deleteMany({
      where: {
        userId: { in: cacheUserIds },
        ddbCharacterId,
      },
    });
  } else {
    const cached = await loadCachedCharacter(cacheUserIds, ddbCharacterId);
    if (cached) return cached;
  }

  const cobalt = await getCobaltForUser(providerId);
  if (!cobalt) throw new Error('D&D Beyond account not linked');

  const raw = await fetchRawCharacter(cobalt, ddbCharacterId);
  
  // TEMP DEBUG LOG
  console.log('\n=== DDB RAW CHARACTER DEBUG ===');
  console.log('Top-level keys:', Object.keys(raw).sort());
  console.log('Looking for AC fields:');
  console.log('raw.armorClass:', (raw as any).armorClass);
  console.log('raw.ac:', (raw as any).ac);
  console.log('raw.stats:', (raw as any).stats);
  console.log('raw.overview:', (raw as any).overview);
  console.log('Looking for HP fields:');
  console.log('raw.maxHitPoints:', (raw as any).maxHitPoints);
  console.log('raw.maxHp:', (raw as any).maxHp);
  console.log('raw.hitPointInfo:', (raw as any).hitPointInfo);
  console.log('raw.hitPointsInfo:', (raw as any).hitPointsInfo);
  console.log('raw.currentHitPoints:', (raw as any).currentHitPoints);
  console.log('raw.removedHitPoints:', (raw as any).removedHitPoints);
  console.log('raw.overrideHitPoints:', (raw as any).overrideHitPoints);
  console.log('raw.adjustedHitPoints:', (raw as any).adjustedHitPoints);
  console.log('raw.baseHitPoints:', (raw as any).baseHitPoints);
  console.log('raw.bonusHitPoints:', (raw as any).bonusHitPoints);
  console.log('=== END DEBUG ===\n');

  const character = await extractCharacter(cobalt, ddbCharacterId);
  const snapshot = { ...character, ddbNormalizerVersion: DDB_NORMALIZER_VERSION };
  await readPrisma.ddbCharacterCache.upsert({
    where: { userId_ddbCharacterId: { userId: providerId, ddbCharacterId } },
    create: {
      userId: providerId,
      ddbCharacterId,
      name: character.name,
      campaignId: character.campaignId ?? null,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      updateId: character.updateId ?? 0,
      lastSyncedAt: new Date(),
    },
    update: {
      name: character.name,
      campaignId: character.campaignId ?? null,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
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

  const cached = await readPrisma.ddbCharacterCache.findUnique({
    where: { userId_ddbCharacterId: { userId, ddbCharacterId } },
  });

  if (cached) {
    const snap = coerceGrimoireCharacter({
      ...(cached.snapshot as unknown as Partial<GrimoireCharacter>),
      ddbCharacterId,
    });
    const next = coerceGrimoireCharacter({ ...snap, hp, tempHp, lastSyncedAt: new Date().toISOString() });
    await readPrisma.ddbCharacterCache.update({
      where: { id: cached.id },
      data: {
        snapshot: {
          ...next,
          ddbNormalizerVersion: DDB_NORMALIZER_VERSION,
        } as unknown as Prisma.InputJsonValue,
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

  const cached = await readPrisma.ddbCharacterCache.findUnique({
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
    await readPrisma.ddbCharacterCache.update({
      where: { id: cached.id },
      data: {
        snapshot: {
          ...next,
          ddbNormalizerVersion: DDB_NORMALIZER_VERSION,
        } as unknown as Prisma.InputJsonValue,
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

export async function listDdbLibrarySources(
  userId: string,
  opts?: { campaignId?: number; force?: boolean },
) {
  const ctx = await requireDdbAuth(userId);
  return listAccessibleDdbSources(ctx, opts);
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
  opts: {
    kind: 'monster' | 'item' | 'spell';
    ids: number[];
    campaignId?: number;
    sourceId?: number;
    deferCatalogFinish?: boolean;
    skipExisting?: boolean;
    namesById?: Record<number, string>;
  },
) {
  const ctx = await requireDdbAuth(userId);
  const result = await importDdbLibraryEntries(ctx, opts);
  if (result.imported.length === 0 || opts.deferCatalogFinish) {
    return result;
  }
  const sourceIds = opts.sourceId != null ? [opts.sourceId] : [];
  const sourceLabels = [
    ...new Set(result.imported.map((e) => e.source).filter((s): s is string => Boolean(s))),
  ];
  try {
    const fin = await finishDdbLibraryImport(ctx, {
      sourceIds,
      ...(sourceLabels.length > 0 ? { sourceLabels } : {}),
    });
    return {
      ...result,
      catalogRev: fin.catalogRev ?? result.catalogRev,
      sourcesUnlocked: [...new Set([...(result.sourcesUnlocked ?? []), ...(fin.sourcesUnlocked ?? [])])],
    };
  } catch (err) {
    console.warn('[DDB] server-side finish-import after chunk failed:', err);
    return result;
  }
}

export async function importAllFromDdbLibrarySource(
  userId: string,
  opts: { sourceId?: number; sourceIds?: number[]; campaignId?: number; skipExisting?: boolean },
) {
  const ctx = await requireDdbAuth(userId);
  const sourceIds = opts.sourceIds?.length
    ? opts.sourceIds
    : opts.sourceId
      ? [opts.sourceId]
      : [];
  const unique = [...new Set(sourceIds.filter((id) => Number.isFinite(id) && (id > 0 || id === DDB_HOMEBREW_SOURCE_ID)))];
  const { accessible, inaccessible } = await filterAccessibleSourceIds(ctx, unique, {
    campaignId: opts.campaignId,
  });
  const result = await importAllDdbLibraryFromSources(ctx, {
    sourceIds: accessible,
    campaignId: opts.campaignId,
    ...(opts.skipExisting ? { skipExisting: true } : {}),
  });
  if (inaccessible.length === 0) return result;
  return {
    ...result,
    errors: [
      {
        id: 0,
        message: `Skipped ${inaccessible.length} book(s) you don't own or have shared access to`,
      },
      ...result.errors,
    ],
  };
}

export async function finishDdbLibraryImportSession(
  userId: string,
  opts?: {
    sourceIds?: number[];
    sourceLabels?: string[];
    unlockAllImportedSources?: boolean;
    awaitCatalogRebuild?: boolean;
  },
): Promise<{
  catalogRev: string | null;
  sourcesUnlocked?: string[];
  booksCount?: number;
  importedEntryCount?: number;
  catalogRebuildPending?: boolean;
}> {
  const ctx = await requireDdbAuth(userId);
  return finishDdbLibraryImport(ctx, opts);
}

export { fetchDdbCampaigns, fetchDdbCharacterList, fetchDdbEncounters, resolveDdbEncounter, parseDdbEncounterId };
