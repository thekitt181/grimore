import { notifyCompendiumChanged } from './compendiumChangeNotify';

let started = false;
let lastNotifiedMs = 0;
const SELF_ECHO_MS = 400;
const CHANGE_NOTIFY_DEBOUNCE_MS = 2_500;
let bulkImportDepth = 0;
let pendingChangeNotify: ReturnType<typeof setTimeout> | null = null;
let pendingChangeLastUpdated: string | Date = new Date();

/** Call before a VTT-originated compendium write to suppress duplicate socket push. */
export function markCompendiumWritePending(): void {
  lastNotifiedMs = Date.now();
}

/** True while a DDB library import job holds the outer bulk-import lock. */
export function isCompendiumBulkImportActive(): boolean {
  return bulkImportDepth > 0;
}

/** Suppress client pushes while bulk DDB import is running. */
export function beginCompendiumBulkImport(): void {
  bulkImportDepth += 1;
}

/** Resume client pushes and notify clients once when the outermost import finishes. */
export function endCompendiumBulkImport(): void {
  bulkImportDepth = Math.max(0, bulkImportDepth - 1);
  if (bulkImportDepth === 0) {
    if (pendingChangeNotify) {
      clearTimeout(pendingChangeNotify);
      pendingChangeNotify = null;
    }
    notifyCompendiumChanged(new Date());
  }
}

function flushPendingChangeNotify(): void {
  pendingChangeNotify = null;
  notifyCompendiumChanged(pendingChangeLastUpdated);
}

function scheduleChangeNotify(lastUpdated: string | Date): void {
  pendingChangeLastUpdated = lastUpdated;
  if (pendingChangeNotify) return;
  pendingChangeNotify = setTimeout(flushPendingChangeNotify, CHANGE_NOTIFY_DEBOUNCE_MS);
}

/** Postgres-backed compendium — no Mongo change streams; writes notify directly. */
export function startCompendiumMongoWatch(): void {
  if (started) return;
  started = true;
  console.log('[Compendium] Postgres storage active — Mongo change streams disabled');
}

export function resumeCompendiumMongoWatch(): void {
  startCompendiumMongoWatch();
}

/** Optional helper for batched writes that should coalesce socket updates. */
export function notifyCompendiumStorageChanged(lastUpdated: string | Date = new Date()): void {
  const now = Date.now();
  if (bulkImportDepth > 0) return;
  if (now - lastNotifiedMs < SELF_ECHO_MS) return;
  scheduleChangeNotify(lastUpdated);
}
