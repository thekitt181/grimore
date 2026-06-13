import type { Prisma } from '@prisma/client';
import { DDB_HOMEBREW_SOURCE_ID } from '@grimoire/shared';
import type {
  DdbLibraryImportJob,
  DdbLibraryImportJobProgress,
  DdbLibraryImportResult,
} from '@grimoire/shared';
import { prisma } from '../../lib/prisma';
import { sanitizeForPostgres, stripNullBytes } from '../../lib/sanitizePostgresText';
import { getCobaltForUser } from './ddbService';
import { getDdbAuthContext } from './ddbAuthContext';
import { filterAccessibleSourceIds } from './ddbAccessibleSources';
import {
  finishDdbLibraryImport,
  importAllDdbHomebrew,
  importAllDdbLibraryFromSource,
  unlockDdbImportedBook,
} from './ddbLibrary';
import { loadImportSkipIndex } from '../compendiumImportIndex';

const runningJobs = new Set<string>();

function mergeImportResults(...parts: DdbLibraryImportResult[]): DdbLibraryImportResult {
  const imported = parts.flatMap((p) => p.imported);
  const errors = parts.flatMap((p) => p.errors);
  const skipped = parts.reduce((sum, p) => sum + (p.skipped ?? 0), 0);
  if (imported.length === 0 && skipped === 0) {
    return { imported, errors };
  }
  return {
    imported,
    errors,
    ...(skipped > 0 ? { skipped } : {}),
    sourcesUnlocked: [...new Set(parts.flatMap((p) => p.sourcesUnlocked ?? []))],
    mongoPersisted: parts.every((p) => p.mongoPersisted !== false),
    catalogRev: parts.map((p) => p.catalogRev).filter(Boolean).pop(),
  };
}

function parseSourceNames(raw: unknown): Record<number, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<number, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (Number.isFinite(id) && typeof value === 'string' && value.trim()) {
      out[id] = value.trim();
    }
  }
  return out;
}

function toClientJob(row: {
  id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  skipExisting: boolean;
  campaignId: number | null;
  sourceIds: number[];
  sourceNames: unknown;
  progress: unknown;
  result: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): DdbLibraryImportJob {
  const statusMap = {
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  } as const;
  return {
    id: row.id,
    status: statusMap[row.status],
    skipExisting: row.skipExisting,
    campaignId: row.campaignId,
    sourceIds: row.sourceIds,
    sourceNames: parseSourceNames(row.sourceNames),
    progress: (row.progress as DdbLibraryImportJobProgress | null) ?? null,
    result: (row.result as DdbLibraryImportResult | null) ?? null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function isJobCancelled(jobId: string): Promise<boolean> {
  const row = await prisma.ddbLibraryImportJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return row?.status === 'CANCELLED';
}

const STANDARD_KINDS = ['monster', 'spell', 'item'] as const;
type ImportKind = (typeof STANDARD_KINDS)[number];


function normalizeSourceId(id: unknown): number | null {
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

/** Which monster/spell/item pass to run first when resuming a partially imported book. */
function resolveBookKindStart(
  progress: unknown,
  sourceId: number,
): { startKindIndex: number; completedKinds: ImportKind[] } {
  if (!progress || typeof progress !== 'object') {
    return { startKindIndex: 0, completedKinds: [] };
  }
  const p = progress as DdbLibraryImportJobProgress;
  const progressSourceId = normalizeSourceId(p.sourceId);
  const targetSourceId = normalizeSourceId(sourceId);
  if (progressSourceId === null || targetSourceId === null || progressSourceId !== targetSourceId || p.phase === 'complete') {
    return { startKindIndex: 0, completedKinds: [] };
  }

  const fromProgress = (p.completedKinds ?? []).filter((k): k is ImportKind =>
    k === 'monster' || k === 'spell' || k === 'item',
  );
  if (fromProgress.length > 0) {
    const nextIdx = STANDARD_KINDS.findIndex((k) => !fromProgress.includes(k));
    return {
      startKindIndex: nextIdx === -1 ? STANDARD_KINDS.length : nextIdx,
      completedKinds: fromProgress,
    };
  }

  // Legacy jobs: infer completed kinds from last recorded phase.
  const phase = p.phase;
  if (phase === 'items' || phase === 'listing-items') {
    return { startKindIndex: 2, completedKinds: ['monster', 'spell'] };
  }
  if (phase === 'spells' || phase === 'listing-spells') {
    return { startKindIndex: 1, completedKinds: ['monster'] };
  }
  return { startKindIndex: 0, completedKinds: [] };
}

function parseCompletedSourceIds(progress: unknown, accessible: number[]): Set<number> {
  const ids = new Set<number>();
  if (!progress || typeof progress !== 'object') return ids;
  const raw = progress as DdbLibraryImportJobProgress;

  for (const id of raw.completedSourceIds ?? []) {
    const n = normalizeSourceId(id);
    if (n !== null) ids.add(n);
  }

  const currentSourceId = normalizeSourceId(raw.sourceId);
  if (raw.phase === 'complete' && currentSourceId !== null) {
    ids.add(currentSourceId);
  }

  // Jobs started before book-level checkpoints only stored bookIndex + phase.
  if (ids.size === 0 && accessible.length > 0) {
    const bookIndex = Number(raw.bookIndex) || 0;
    if (bookIndex > 1) {
      const completedCount = raw.phase === 'complete' ? bookIndex : bookIndex - 1;
      for (const id of accessible.slice(0, completedCount)) {
        ids.add(id);
      }
      if (completedCount > 0) {
        console.log(
          `[DDB] Inferred ${completedCount} completed book(s) from legacy progress (bookIndex=${bookIndex}, phase=${raw.phase})`,
        );
      }
    }
  }

  return ids;
}

function hasPartialImportProgress(progress: unknown, result: unknown, accessible: number[]): boolean {
  const completed = parseCompletedSourceIds(progress, accessible);
  if (completed.size > 0) return true;
  if (!progress || typeof progress !== 'object') return false;
  const raw = progress as DdbLibraryImportJobProgress;
  if ((raw.completedKinds?.length ?? 0) > 0) return true;
  const bookIndex = Number(raw.bookIndex) || 0;
  if (bookIndex > 1) return true;
  const partial = parsePartialResult(result);
  return partial.imported.length > 0;
}

function parsePartialResult(raw: unknown): DdbLibraryImportResult {
  if (!raw || typeof raw !== 'object') return { imported: [], errors: [] };
  const r = raw as DdbLibraryImportResult;
  return {
    imported: Array.isArray(r.imported) ? r.imported : [],
    errors: Array.isArray(r.errors) ? r.errors : [],
    ...(r.catalogRev ? { catalogRev: r.catalogRev } : {}),
    ...(r.sourcesUnlocked ? { sourcesUnlocked: r.sourcesUnlocked } : {}),
    ...(r.mongoPersisted !== undefined ? { mongoPersisted: r.mongoPersisted } : {}),
    ...(r.skipped !== undefined ? { skipped: r.skipped } : {}),
  };
}

async function persistJobPatch(
  jobId: string,
  data: Prisma.DdbLibraryImportJobUpdateInput,
): Promise<void> {
  const sanitized = sanitizeForPostgres(data);
  await prisma.ddbLibraryImportJob.update({
    where: { id: jobId },
    data: sanitized,
  });
}

async function updateJobProgress(jobId: string, progress: DdbLibraryImportJobProgress): Promise<void> {
  await persistJobPatch(jobId, {
    progress: progress as unknown as Prisma.InputJsonValue,
  });
}

async function persistPartialResult(jobId: string, result: DdbLibraryImportResult): Promise<void> {
  try {
    await persistJobPatch(jobId, {
      result: result as unknown as Prisma.InputJsonValue,
    });
  } catch (err) {
    console.warn(`[DDB] Could not persist partial import result for job ${jobId}:`, err);
  }
}

async function finishJob(
  jobId: string,
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
  data: {
    result?: DdbLibraryImportResult;
    errorMessage?: string;
    progress?: DdbLibraryImportJobProgress;
  },
): Promise<void> {
  const payload: Prisma.DdbLibraryImportJobUpdateInput = {
    status,
    completedAt: new Date(),
    ...(data.result ? { result: data.result as unknown as Prisma.InputJsonValue } : {}),
    ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
    ...(data.progress ? { progress: data.progress as unknown as Prisma.InputJsonValue } : {}),
  };

  try {
    await persistJobPatch(jobId, payload);
  } catch (err) {
    console.error(`[DDB] finishJob ${jobId} failed — saving status only:`, err);
    await prisma.ddbLibraryImportJob.update({
      where: { id: jobId },
      data: {
        status,
        completedAt: new Date(),
        errorMessage: stripNullBytes(
          data.errorMessage ?? 'Import finished but job record could not store full details',
        ),
      },
    });
  }
}

async function requireDdbAuthForUser(userId: string) {
  const cobalt = await getCobaltForUser(userId);
  if (!cobalt) throw new Error('D&D Beyond account not linked');
  const ctx = await getDdbAuthContext(cobalt);
  if (!ctx) throw new Error('D&D Beyond session invalid — re-link your account');
  return ctx;
}

function sameSourceIdSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a.map((id) => normalizeSourceId(id)).filter((id): id is number => id !== null));
  return b.every((id) => {
    const n = normalizeSourceId(id);
    return n !== null && left.has(n);
  });
}

async function runDdbLibraryImportJob(jobId: string): Promise<void> {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  let merged: DdbLibraryImportResult = { imported: [], errors: [] };
  const { beginCompendiumBulkImport, endCompendiumBulkImport } = await import('../compendiumMongoWatch');
  beginCompendiumBulkImport();
  try {
    const job = await prisma.ddbLibraryImportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'RUNNING') return;

    const ctx = await requireDdbAuthForUser(job.userId);
    const sourceNames = parseSourceNames(job.sourceNames);
    const unique = [...new Set(job.sourceIds.filter((id) => Number.isFinite(id) && (id > 0 || id === DDB_HOMEBREW_SOURCE_ID)))];
    const { accessible, inaccessible } = await filterAccessibleSourceIds(ctx, unique, {
      campaignId: job.campaignId ?? undefined,
    });

    const completedSourceIds = parseCompletedSourceIds(job.progress, accessible);
    const pendingAccessible = accessible.filter((id) => !completedSourceIds.has(id));

    merged = parsePartialResult(job.result);
    if (inaccessible.length > 0 && merged.errors.length === 0) {
      merged.errors.push({
        id: 0,
        message: `Skipped ${inaccessible.length} book(s) you don't own or have shared access to`,
      });
    } else if (inaccessible.length > 0) {
      const msg = `Skipped ${inaccessible.length} book(s) you don't own or have shared access to`;
      if (!merged.errors.some((e) => e.message === msg)) {
        merged.errors.push({ id: 0, message: msg });
      }
    }

    if (pendingAccessible.length === 0) {
      await finishJob(jobId, 'COMPLETED', { result: merged });
      return;
    }

    if (completedSourceIds.size > 0 || (job.progress && (job.progress as unknown as DdbLibraryImportJobProgress).completedKinds?.length)) {
      console.log(
        `[DDB] Resuming import job ${jobId}: ${completedSourceIds.size} book(s) done, ${pendingAccessible.length} remaining`,
      );
    }

    const skipIndex = job.skipExisting ? await loadImportSkipIndex(true) : undefined;

    const bookTotal = accessible.length;
    const completedCount = completedSourceIds.size;

    // Backfill completedSourceIds for legacy jobs so UI + future restarts see correct book position.
    const initialProgress = job.progress as DdbLibraryImportJobProgress | null;
    if (
      initialProgress
      && completedCount > 0
      && (initialProgress.completedSourceIds?.length ?? 0) === 0
      && pendingAccessible.length > 0
    ) {
      const currentSourceId = pendingAccessible[0]!;
      const currentName = sourceNames[currentSourceId];
      await updateJobProgress(jobId, {
        ...initialProgress,
        sourceId: currentSourceId,
        bookIndex: completedCount + 1,
        bookTotal,
        completedSourceIds: [...completedSourceIds],
        ...(currentName ? { sourceName: currentName } : {}),
      });
    }

    for (const [pendingIdx, sourceId] of pendingAccessible.entries()) {
      if (await isJobCancelled(jobId)) return;

      const progressRow = await prisma.ddbLibraryImportJob.findUnique({
        where: { id: jobId },
        select: { progress: true },
      });
      const savedProgress = (progressRow?.progress ?? null) as DdbLibraryImportJobProgress | null;

      const bookIndex = completedCount + pendingIdx + 1;
      const sourceName = sourceNames[sourceId];
      let bookMerged: DdbLibraryImportResult = { imported: [], errors: [] };

      const progressBase = {
        sourceId,
        bookIndex,
        bookTotal,
        completedSourceIds: [...completedSourceIds, ...pendingAccessible.slice(0, pendingIdx)],
        ...(sourceName ? { sourceName } : {}),
      };

      if (sourceId === DDB_HOMEBREW_SOURCE_ID) {
        const homebrewDone =
          savedProgress?.sourceId === sourceId
          && (savedProgress.completedKinds?.includes('monster')
            || savedProgress.phase === 'complete'
            || savedProgress.phase === 'spells'
            || savedProgress.phase === 'items');
        if (!homebrewDone) {
          await updateJobProgress(jobId, {
            ...progressBase,
            phase: 'monsters',
            done: 0,
            total: 0,
            completedKinds: [],
          });
          bookMerged = await importAllDdbHomebrew(ctx, {
            campaignId: job.campaignId ?? undefined,
            ...(job.skipExisting ? { skipExisting: true, skipIndex } : {}),
          });
          merged = mergeImportResults(merged, bookMerged);
          await persistPartialResult(jobId, merged);
        } else {
          console.log(`[DDB] Skipping homebrew — already imported before restart`);
        }
      } else {
        const { startKindIndex, completedKinds } = resolveBookKindStart(savedProgress, sourceId);
        if (startKindIndex > 0 || completedKinds.length > 0) {
          console.log(
            `[DDB] Resuming book ${sourceId} (${sourceName ?? 'unknown'}): kinds done [${completedKinds.join(', ')}], starting at ${STANDARD_KINDS[startKindIndex] ?? 'finish'}`,
          );
        }

        const kindsDone: ImportKind[] = [...completedKinds];
        const kindsToRun = STANDARD_KINDS.slice(startKindIndex);

        if (kindsToRun.length > 0) {
          const kindProgress: Record<ImportKind, { done: number; total: number }> = {
            monster: { done: 0, total: 0 },
            spell: { done: 0, total: 0 },
            item: { done: 0, total: 0 },
          };
          let lastKindProgressAt = 0;

          const flushKindProgress = () => {
            const done = kindProgress.monster.done + kindProgress.spell.done + kindProgress.item.done;
            const total = kindProgress.monster.total + kindProgress.spell.total + kindProgress.item.total;
            void updateJobProgress(jobId, {
              ...progressBase,
              phase: kindsToRun.includes('monster') ? 'monsters' : kindsToRun.includes('spell') ? 'spells' : 'items',
              done,
              total,
              completedKinds: kindsDone,
            });
          };

          await updateJobProgress(jobId, {
            ...progressBase,
            phase: 'monsters',
            done: 0,
            total: 0,
            completedKinds: kindsDone,
          });

          const kindResults = await Promise.all(
            kindsToRun.map(async (kind) => {
              if (await isJobCancelled(jobId)) {
                return { imported: [], errors: [] } satisfies DdbLibraryImportResult;
              }
              const onProgress = (done: number, total: number) => {
                kindProgress[kind] = { done, total };
                const now = Date.now();
                if (done < total && now - lastKindProgressAt < 1500) return;
                lastKindProgressAt = now;
                flushKindProgress();
              };
              return importAllDdbLibraryFromSource(ctx, {
                kind,
                sourceId,
                campaignId: job.campaignId ?? undefined,
                ...(job.skipExisting ? { skipExisting: true, skipIndex } : {}),
                onProgress,
              });
            }),
          );

          for (const chunk of kindResults) {
            bookMerged = mergeImportResults(bookMerged, chunk);
            merged = mergeImportResults(merged, chunk);
          }
          kindsDone.push(...kindsToRun);
          flushKindProgress();
          await persistPartialResult(jobId, merged);
        }
      }

      try {
        const unlocked = await unlockDdbImportedBook(
          ctx,
          sourceId,
          sourceName,
          bookMerged.imported,
        );
        merged = {
          ...merged,
          sourcesUnlocked: [...new Set([...(merged.sourcesUnlocked ?? []), ...unlocked])],
        };
        await persistPartialResult(jobId, merged);
      } catch (err) {
        console.warn(`[DDB] unlock sources failed for job ${jobId} source ${sourceId}:`, err);
      }

      const doneIds = [...completedSourceIds, ...pendingAccessible.slice(0, pendingIdx + 1)];
      await updateJobProgress(jobId, {
        ...progressBase,
        phase: 'complete',
        done: bookIndex,
        total: bookTotal,
        bookImported: bookMerged.imported.length,
        bookErrors: bookMerged.errors.length,
        completedSourceIds: doneIds,
        completedKinds: [],
      });
      completedSourceIds.add(sourceId);
      await persistPartialResult(jobId, merged);
    }

    if (await isJobCancelled(jobId)) return;

    try {
      const fin = await finishDdbLibraryImport(ctx, {
        sourceIds: accessible.filter((id) => id > 0),
        unlockAllImportedSources: true,
        awaitCatalogRebuild: true,
      });
      merged = {
        ...merged,
        catalogRev: fin.catalogRev ?? merged.catalogRev,
        sourcesUnlocked: [...new Set([...(merged.sourcesUnlocked ?? []), ...(fin.sourcesUnlocked ?? [])])],
      };
      const { getCatalogEntryCounts } = await import('../compendiumSync');
      console.log(
        `[DDB] Import job ${jobId} catalog ready: `
        + `${getCatalogEntryCounts()?.monsters ?? 0} monsters, `
        + `${getCatalogEntryCounts()?.items ?? 0} items, `
        + `${getCatalogEntryCounts()?.spells ?? 0} spells`,
      );
    } catch (err) {
      console.warn(`[DDB] finish-import after job ${jobId} failed:`, err);
    }

    const { invalidateImportSkipIndex } = await import('../compendiumImportIndex');
    invalidateImportSkipIndex();

    await finishJob(jobId, 'COMPLETED', { result: merged });
  } catch (err) {
    const message = stripNullBytes(err instanceof Error ? err.message : 'Import failed');
    console.error(`[DDB] import job ${jobId} failed:`, err);
    await finishJob(jobId, 'FAILED', { errorMessage: message, result: merged });
  } finally {
    endCompendiumBulkImport();
    runningJobs.delete(jobId);
  }
}

export async function resumeRunningImportJobs(): Promise<void> {
  const rows = await prisma.ddbLibraryImportJob.findMany({
    where: {
      OR: [{ status: 'RUNNING' }, { status: 'FAILED' }],
    },
    select: { id: true, status: true, progress: true, result: true, sourceIds: true, userId: true },
    orderBy: { createdAt: 'asc' },
  });

  const runningByUser = new Map<string, string>();
  const failedRows: typeof rows = [];

  for (const row of rows) {
    if (row.status === 'RUNNING') {
      runningByUser.set(row.userId, row.id);
    } else {
      failedRows.push(row);
    }
  }

  for (const jobId of runningByUser.values()) {
    void runDdbLibraryImportJob(jobId);
  }

  for (const row of failedRows) {
    if (runningByUser.has(row.userId)) continue;
    const accessible = row.sourceIds.filter((id) => Number.isFinite(id) && (id > 0 || id === DDB_HOMEBREW_SOURCE_ID));
    if (!hasPartialImportProgress(row.progress, row.result, accessible)) continue;
    console.log(`[DDB] Re-opening failed import job ${row.id} with partial progress`);
    await prisma.ddbLibraryImportJob.update({
      where: { id: row.id },
      data: {
        status: 'RUNNING',
        errorMessage: null,
        completedAt: null,
      },
    });
    void runDdbLibraryImportJob(row.id);
  }
}

export async function startDdbLibraryImportJob(
  userId: string,
  opts: {
    sourceIds: number[];
    sourceNames?: Record<number, string>;
    campaignId?: number;
    skipExisting?: boolean;
  },
): Promise<DdbLibraryImportJob> {
  const unique = [...new Set(opts.sourceIds.filter((id) => Number.isFinite(id) && (id > 0 || id === DDB_HOMEBREW_SOURCE_ID)))];
  if (unique.length === 0) {
    throw new Error('Select at least one source book');
  }

  const failedResume = await prisma.ddbLibraryImportJob.findFirst({
    where: { userId, status: 'FAILED' },
    orderBy: { createdAt: 'desc' },
  });
  if (
    failedResume
    && sameSourceIdSet(failedResume.sourceIds, unique)
    && hasPartialImportProgress(failedResume.progress, failedResume.result, unique)
  ) {
    console.log(`[DDB] Resuming failed import job ${failedResume.id} instead of starting over`);
    await prisma.ddbLibraryImportJob.updateMany({
      where: { userId, status: 'RUNNING' },
      data: {
        status: 'CANCELLED',
        errorMessage: 'Superseded by resumed import job',
        completedAt: new Date(),
      },
    });
    const reopened = await prisma.ddbLibraryImportJob.update({
      where: { id: failedResume.id },
      data: {
        status: 'RUNNING',
        skipExisting: Boolean(opts.skipExisting),
        errorMessage: null,
        completedAt: null,
        ...(opts.campaignId !== undefined ? { campaignId: opts.campaignId ?? null } : {}),
      },
    });
    void runDdbLibraryImportJob(reopened.id);
    return toClientJob(reopened);
  }

  await prisma.ddbLibraryImportJob.updateMany({
    where: { userId, status: 'RUNNING' },
    data: {
      status: 'CANCELLED',
      errorMessage: 'Superseded by a new import job',
      completedAt: new Date(),
    },
  });

  const row = await prisma.ddbLibraryImportJob.create({
    data: sanitizeForPostgres({
      userId,
      skipExisting: Boolean(opts.skipExisting),
      campaignId: opts.campaignId ?? null,
      sourceIds: unique,
      sourceNames: (opts.sourceNames ?? {}) as unknown as Prisma.InputJsonValue,
      progress: {
        phase: 'listing-monsters',
        sourceId: unique[0] ?? 0,
        bookIndex: 1,
        bookTotal: unique.length,
        done: 0,
        total: 0,
        completedSourceIds: [],
      } as unknown as Prisma.InputJsonValue,
    }),
  });

  void runDdbLibraryImportJob(row.id);
  return toClientJob(row);
}

export async function getDdbLibraryImportJob(
  userId: string,
  jobId: string,
): Promise<DdbLibraryImportJob | null> {
  const row = await prisma.ddbLibraryImportJob.findFirst({
    where: { id: jobId, userId },
  });
  return row ? toClientJob(row) : null;
}

export async function getActiveDdbLibraryImportJob(userId: string): Promise<DdbLibraryImportJob | null> {
  const row = await prisma.ddbLibraryImportJob.findFirst({
    where: { userId, status: 'RUNNING' },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toClientJob(row) : null;
}

export async function cancelDdbLibraryImportJob(userId: string, jobId: string): Promise<DdbLibraryImportJob | null> {
  const row = await prisma.ddbLibraryImportJob.findFirst({
    where: { id: jobId, userId, status: 'RUNNING' },
  });
  if (!row) return null;
  const updated = await prisma.ddbLibraryImportJob.update({
    where: { id: jobId },
    data: {
      status: 'CANCELLED',
      errorMessage: 'Cancelled by user',
      completedAt: new Date(),
    },
  });
  return toClientJob(updated);
}
