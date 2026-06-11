import type { Prisma } from '@prisma/client';
import { DDB_HOMEBREW_SOURCE_ID } from '@grimoire/shared';
import type {
  DdbLibraryImportJob,
  DdbLibraryImportJobProgress,
  DdbLibraryImportResult,
} from '@grimoire/shared';
import { prisma } from '../../lib/prisma';
import { getCobaltForUser } from './ddbService';
import { getDdbAuthContext } from './ddbAuthContext';
import { filterAccessibleSourceIds } from './ddbAccessibleSources';
import {
  finishDdbLibraryImport,
  importAllDdbHomebrew,
  importAllDdbLibraryFromSource,
} from './ddbLibrary';

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

async function updateJobProgress(jobId: string, progress: DdbLibraryImportJobProgress): Promise<void> {
  await prisma.ddbLibraryImportJob.update({
    where: { id: jobId },
    data: { progress: progress as unknown as Prisma.InputJsonValue },
  });
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
  await prisma.ddbLibraryImportJob.update({
    where: { id: jobId },
    data: {
      status,
      completedAt: new Date(),
      ...(data.result ? { result: data.result as unknown as Prisma.InputJsonValue } : {}),
      ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
      ...(data.progress ? { progress: data.progress as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

async function requireDdbAuthForUser(userId: string) {
  const cobalt = await getCobaltForUser(userId);
  if (!cobalt) throw new Error('D&D Beyond account not linked');
  const ctx = await getDdbAuthContext(cobalt);
  if (!ctx) throw new Error('D&D Beyond session invalid — re-link your account');
  return ctx;
}

async function runDdbLibraryImportJob(jobId: string): Promise<void> {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  try {
    const job = await prisma.ddbLibraryImportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'RUNNING') return;

    const ctx = await requireDdbAuthForUser(job.userId);
    const sourceNames = parseSourceNames(job.sourceNames);
    const unique = [...new Set(job.sourceIds.filter((id) => Number.isFinite(id) && (id > 0 || id === DDB_HOMEBREW_SOURCE_ID)))];
    const { accessible, inaccessible } = await filterAccessibleSourceIds(ctx, unique, {
      campaignId: job.campaignId ?? undefined,
    });

    let merged: DdbLibraryImportResult = { imported: [], errors: [] };
    if (inaccessible.length > 0) {
      merged.errors.push({
        id: 0,
        message: `Skipped ${inaccessible.length} book(s) you don't own or have shared access to`,
      });
    }

    const bookTotal = accessible.length;
    for (const [bookIdx, sourceId] of accessible.entries()) {
      if (await isJobCancelled(jobId)) return;

      const bookIndex = bookIdx + 1;
      const sourceName = sourceNames[sourceId];
      let bookMerged: DdbLibraryImportResult = { imported: [], errors: [] };

      const progressBase = {
        sourceId,
        bookIndex,
        bookTotal,
        ...(sourceName ? { sourceName } : {}),
      };

      if (sourceId === DDB_HOMEBREW_SOURCE_ID) {
        await updateJobProgress(jobId, {
          ...progressBase,
          phase: 'monsters',
          done: 0,
          total: 0,
        });
        bookMerged = await importAllDdbHomebrew(ctx, {
          campaignId: job.campaignId ?? undefined,
          ...(job.skipExisting ? { skipExisting: true } : {}),
        });
        merged = mergeImportResults(merged, bookMerged);
      } else {
        for (const kind of ['monster', 'spell', 'item'] as const) {
          if (await isJobCancelled(jobId)) return;
          const phase = kind === 'monster' ? 'monsters' : kind === 'spell' ? 'spells' : 'items';
          await updateJobProgress(jobId, {
            ...progressBase,
            phase,
            done: 0,
            total: 0,
          });
          const chunk = await importAllDdbLibraryFromSource(ctx, {
            kind,
            sourceId,
            campaignId: job.campaignId ?? undefined,
            ...(job.skipExisting ? { skipExisting: true } : {}),
          });
          bookMerged = mergeImportResults(bookMerged, chunk);
          merged = mergeImportResults(merged, chunk);
        }
      }

      if (bookMerged.imported.length > 0) {
        const sourceLabels = [
          ...new Set(bookMerged.imported.map((e) => e.source).filter((s): s is string => Boolean(s))),
        ];
        try {
          const fin = await finishDdbLibraryImport(ctx, {
            sourceIds: sourceId > 0 ? [sourceId] : [],
            ...(sourceLabels.length > 0 ? { sourceLabels } : {}),
          });
          merged = {
            ...merged,
            catalogRev: fin.catalogRev ?? merged.catalogRev,
            sourcesUnlocked: [...new Set([...(merged.sourcesUnlocked ?? []), ...(fin.sourcesUnlocked ?? [])])],
          };
        } catch (err) {
          console.warn(`[DDB] finish-import failed for job ${jobId} source ${sourceId}:`, err);
        }
      }

      await updateJobProgress(jobId, {
        ...progressBase,
        phase: 'complete',
        done: bookIndex,
        total: bookTotal,
        bookImported: bookMerged.imported.length,
        bookErrors: bookMerged.errors.length,
      });
    }

    if (await isJobCancelled(jobId)) return;

    try {
      const { notifyCompendiumCatalogRebuilt } = await import('../compendiumChangeNotify');
      await notifyCompendiumCatalogRebuilt(new Date());
    } catch (err) {
      console.warn('[DDB] compendium notify after import job failed:', err);
    }

    await finishJob(jobId, 'COMPLETED', { result: merged });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    console.error(`[DDB] import job ${jobId} failed:`, err);
    await finishJob(jobId, 'FAILED', { errorMessage: message });
  } finally {
    runningJobs.delete(jobId);
  }
}

export async function resumeRunningImportJobs(): Promise<void> {
  const rows = await prisma.ddbLibraryImportJob.findMany({
    where: { status: 'RUNNING' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const row of rows) {
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

  await prisma.ddbLibraryImportJob.updateMany({
    where: { userId, status: 'RUNNING' },
    data: {
      status: 'CANCELLED',
      errorMessage: 'Superseded by a new import job',
      completedAt: new Date(),
    },
  });

  const row = await prisma.ddbLibraryImportJob.create({
    data: {
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
      } as unknown as Prisma.InputJsonValue,
    },
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
