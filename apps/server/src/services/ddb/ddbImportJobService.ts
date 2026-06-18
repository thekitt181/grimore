import type { Prisma } from '@prisma/client';
import { DDB_HOMEBREW_SOURCE_ID } from '@grimoire/shared';
import type {
  DdbLibraryImportJob,
  DdbLibraryImportJobProgress,
  DdbLibraryImportResult,
} from '@grimoire/shared';
import { readPrisma } from '../../lib/prisma';
import { sanitizeForPostgres, stripNullBytes } from '../../lib/sanitizePostgresText';
import { getCobaltForUser } from './ddbService';
import { getDdbAuthContext } from './ddbAuthContext';
import { filterAccessibleSourceIds } from './ddbAccessibleSources';
import {
  importAllDdbLibraryFromSource,
} from './ddbLibrary';
import { loadImportSkipIndex } from '../compendiumImportIndex';

const runningJobs = new Set<string>();
const STALE_IMPORT_JOB_MS = 3 * 60 * 1000;

/** On server boot, cancel RUNNING jobs left over from a crashed deploy so they don't resume. */
export async function releaseStaleImportJobsOnStartup(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_IMPORT_JOB_MS);
  const result = await readPrisma.ddbLibraryImportJob.updateMany({
    where: { status: 'RUNNING', updatedAt: { lt: cutoff } },
    data: {
      status: 'FAILED',
      errorMessage: 'Import interrupted by server restart — start a new import when ready',
      completedAt: new Date(),
    },
  });
  if (result.count > 0) {
    console.log(`[DDB] Released ${result.count} stale RUNNING import job(s) after restart`);
  }
}

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
  const row = await readPrisma.ddbLibraryImportJob.findUnique({
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
  await readPrisma.ddbLibraryImportJob.update({
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
    await readPrisma.ddbLibraryImportJob.update({
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

function importPhaseForKind(kind: ImportKind): DdbLibraryImportJobProgress['phase'] {
  if (kind === 'monster') return 'monsters';
  if (kind === 'spell') return 'spells';
  return 'items';
}

async function importBookKinds(
  jobId: string,
  ctx: Awaited<ReturnType<typeof requireDdbAuthForUser>>,
  sourceId: number,
  progressBase: {
    sourceId: number;
    bookIndex: number;
    bookTotal: number;
    completedSourceIds: number[];
    sourceName?: string;
  },
  job: { campaignId: number | null; skipExisting: boolean },
  skipIndex: Awaited<ReturnType<typeof loadImportSkipIndex>> | undefined,
  savedProgress: DdbLibraryImportJobProgress | null,
): Promise<DdbLibraryImportResult> {
  const { startKindIndex, completedKinds } = resolveBookKindStart(savedProgress, sourceId);
  const kindsDone: ImportKind[] = [...completedKinds];
  const kindsToRun = STANDARD_KINDS.slice(startKindIndex);
  let bookMerged: DdbLibraryImportResult = { imported: [], errors: [] };

  if (startKindIndex > 0 || completedKinds.length > 0) {
    console.log(
      `[DDB] Resuming book ${sourceId}: kinds done [${completedKinds.join(', ')}], starting at ${STANDARD_KINDS[startKindIndex] ?? 'finish'}`,
    );
  }

  for (const kind of kindsToRun) {
    if (await isJobCancelled(jobId)) break;

    const phase = importPhaseForKind(kind);
    let lastProgressAt = 0;

    await updateJobProgress(jobId, {
      ...progressBase,
      phase,
      done: 0,
      total: 0,
      completedKinds: kindsDone,
    });

    const onProgress = (done: number, total: number) => {
      const now = Date.now();
      const heartbeatDue = now - lastProgressAt >= 45_000;
      if (done < total && now - lastProgressAt < 1200 && !heartbeatDue) return;
      lastProgressAt = now;
      void updateJobProgress(jobId, {
        ...progressBase,
        phase,
        done,
        total,
        completedKinds: kindsDone,
      });
    };

    const chunk = await importAllDdbLibraryFromSource(ctx, {
      kind,
      sourceId,
      campaignId: job.campaignId ?? undefined,
      ...(job.skipExisting ? { skipExisting: true, skipIndex } : {}),
      onProgress,
    });
    bookMerged = mergeImportResults(bookMerged, chunk);
    kindsDone.push(kind);
    await updateJobProgress(jobId, {
      ...progressBase,
      phase,
      done: Math.max(1, chunk.imported.length + (chunk.skipped ?? 0)),
      total: Math.max(1, chunk.imported.length + (chunk.skipped ?? 0)),
      completedKinds: kindsDone,
    });
  }

  return bookMerged;
}

async function finalizeDdbImportJobCatalog(
  merged: DdbLibraryImportResult,
): Promise<DdbLibraryImportResult> {
  const { ensureImportedSourcesUnlocked } = await import('../compendiumBundledLock');
  const { finishBulkCompendiumImport, getCatalogRevision } = await import('../compendiumSync');
  const { invalidateBookSourcesCache } = await import('../compendiumBookSourcesCache');
  const { touchCompendiumMeta } = await import('../compendiumPostgres');
  await ensureImportedSourcesUnlocked('ddb-import-job-finish');
  invalidateBookSourcesCache();
  const fin = await finishBulkCompendiumImport({ deferCatalogRebuild: true });
  await touchCompendiumMeta().catch(() => undefined);
  const next = {
    ...merged,
    catalogRev: fin.catalogRev ?? getCatalogRevision() ?? merged.catalogRev,
  };
  const { getCatalogEntryCounts } = await import('../compendiumSync');
  console.log(
    `[DDB] Import job catalog ready: `
    + `${getCatalogEntryCounts()?.monsters ?? 0} monsters, `
    + `${getCatalogEntryCounts()?.items ?? 0} items, `
    + `${getCatalogEntryCounts()?.spells ?? 0} spells`,
  );
  return next;
}

async function runDdbLibraryImportJob(jobId: string): Promise<void> {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  let merged: DdbLibraryImportResult = { imported: [], errors: [] };
  const { beginCompendiumBulkImport, endCompendiumBulkImport } = await import('../compendiumMongoWatch');
  beginCompendiumBulkImport();
  try {
    const { pingCompendiumStorage } = await import('../compendiumPostgres');
    const storageOk = await pingCompendiumStorage();
    if (!storageOk) {
      await finishJob(jobId, 'FAILED', {
        errorMessage: 'Compendium database unavailable — wait a minute and try again',
        result: merged,
      });
      return;
    }

    const job = await readPrisma.ddbLibraryImportJob.findUnique({ where: { id: jobId } });
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

    if (accessible.length === 0) {
      await finishJob(jobId, 'FAILED', {
        errorMessage: inaccessible.length > 0
          ? 'None of the selected books are accessible with your D&D Beyond account. Re-link or link a campaign for shared books.'
          : 'No accessible books to import',
        result: merged,
      });
      return;
    }

    if (pendingAccessible.length === 0) {
      try {
        merged = await finalizeDdbImportJobCatalog(merged);
      } catch (err) {
        console.warn(`[DDB] finish-import after job ${jobId} failed:`, err);
      }
      const { invalidateImportSkipIndex } = await import('../compendiumImportIndex');
      invalidateImportSkipIndex();
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

      const progressRow = await readPrisma.ddbLibraryImportJob.findUnique({
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

      bookMerged = await importBookKinds(
        jobId,
        ctx,
        sourceId,
        progressBase,
        job,
        skipIndex,
        savedProgress,
      );
      merged = mergeImportResults(merged, bookMerged);
      await persistPartialResult(jobId, merged);

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
      merged = await finalizeDdbImportJobCatalog(merged);
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

function isImportJobStale(updatedAt: Date): boolean {
  return Date.now() - updatedAt.getTime() > STALE_IMPORT_JOB_MS;
}

function kickStaleImportJobIfNeeded(row: { id: string; updatedAt: Date }): void {
  if (!isImportJobStale(row.updatedAt)) return;
  if (runningJobs.has(row.id)) {
    console.warn(`[DDB] Stale import job ${row.id} — clearing stuck in-process handle`);
    runningJobs.delete(row.id);
  }
  console.log(
    `[DDB] Resuming stale import job ${row.id} (no progress for ${Math.round((Date.now() - row.updatedAt.getTime()) / 1000)}s)`,
  );
  void runDdbLibraryImportJob(row.id);
}

export async function resumeRunningImportJobs(): Promise<void> {
  try {
    const rows = await readPrisma.ddbLibraryImportJob.findMany({
      where: {
        OR: [{ status: 'RUNNING' }, { status: 'FAILED' }],
      },
      select: { id: true, status: true, progress: true, result: true, sourceIds: true, userId: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const runningByUser = new Map<string, string>();
    const failedRows: typeof rows = [];

    for (const row of rows) {
      if (row.status === 'RUNNING') {
        runningByUser.set(row.userId, row.id);
        if (isImportJobStale(row.updatedAt)) {
          kickStaleImportJobIfNeeded(row);
        }
      } else {
        failedRows.push(row);
      }
    }

    for (const jobId of runningByUser.values()) {
      if (!runningJobs.has(jobId)) {
        void runDdbLibraryImportJob(jobId);
      }
    }

    for (const row of failedRows) {
      if (runningByUser.has(row.userId)) continue;
      const accessible = row.sourceIds.filter((id) => Number.isFinite(id) && (id > 0 || id === DDB_HOMEBREW_SOURCE_ID));
      if (!hasPartialImportProgress(row.progress, row.result, accessible)) continue;
      console.log(`[DDB] Re-opening failed import job ${row.id} with partial progress`);
      try {
        await readPrisma.ddbLibraryImportJob.update({
          where: { id: row.id },
          data: {
            status: 'RUNNING',
            errorMessage: null,
            completedAt: null,
          },
        });
        void runDdbLibraryImportJob(row.id);
      } catch (err) {
        console.warn(`[DDB] Could not re-open failed import job ${row.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[DDB] resumeRunningImportJobs failed (non-fatal — API stays up):', err);
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

  await requireDdbAuthForUser(userId);

  const failedResume = await readPrisma.ddbLibraryImportJob.findFirst({
    where: { userId, status: 'FAILED' },
    orderBy: { createdAt: 'desc' },
  });
  if (
    failedResume
    && sameSourceIdSet(failedResume.sourceIds, unique)
    && hasPartialImportProgress(failedResume.progress, failedResume.result, unique)
  ) {
    console.log(`[DDB] Resuming failed import job ${failedResume.id} instead of starting over`);
    await readPrisma.ddbLibraryImportJob.updateMany({
      where: { userId, status: 'RUNNING' },
      data: {
        status: 'CANCELLED',
        errorMessage: 'Superseded by resumed import job',
        completedAt: new Date(),
      },
    });
    const reopened = await readPrisma.ddbLibraryImportJob.update({
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

  await readPrisma.ddbLibraryImportJob.updateMany({
    where: { userId, status: 'RUNNING' },
    data: {
      status: 'CANCELLED',
      errorMessage: 'Superseded by a new import job',
      completedAt: new Date(),
    },
  });

  const row = await readPrisma.ddbLibraryImportJob.create({
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
  const row = await readPrisma.ddbLibraryImportJob.findFirst({
    where: { id: jobId, userId },
  });
  if (row?.status === 'RUNNING') kickStaleImportJobIfNeeded(row);
  return row ? toClientJob(row) : null;
}

export async function getActiveDdbLibraryImportJob(userId: string): Promise<DdbLibraryImportJob | null> {
  const row = await readPrisma.ddbLibraryImportJob.findFirst({
    where: { userId, status: 'RUNNING' },
    orderBy: { createdAt: 'desc' },
  });
  if (row) kickStaleImportJobIfNeeded(row);
  return row ? toClientJob(row) : null;
}

export async function cancelDdbLibraryImportJob(userId: string, jobId: string): Promise<DdbLibraryImportJob | null> {
  const row = await readPrisma.ddbLibraryImportJob.findFirst({
    where: { id: jobId, userId, status: 'RUNNING' },
  });
  if (!row) return null;
  const updated = await readPrisma.ddbLibraryImportJob.update({
    where: { id: jobId },
    data: {
      status: 'CANCELLED',
      errorMessage: 'Cancelled by user',
      completedAt: new Date(),
    },
  });
  return toClientJob(updated);
}
