import type { ChangeStreamDocument } from 'mongodb';
import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { getCollection, isMongoConfigured, isMongoCircuitOpen } from '../lib/mongo';
import { notifyCompendiumChanged } from './compendiumChangeNotify';

const WATCH_COLLECTIONS = ['data', 'monsters', 'items', 'spells'] as const;

let started = false;
let lastNotifiedMs = 0;
/** Ignore change-stream echoes of our own write for this window (ms). */
const SELF_ECHO_MS = 400;
/** Coalesce rapid typed-collection writes (bulk import) into one client push. */
const CHANGE_NOTIFY_DEBOUNCE_MS = 2_500;
let bulkImportDepth = 0;
let pendingChangeNotify: ReturnType<typeof setTimeout> | null = null;
let pendingChangeLastUpdated: string | Date = new Date();

/** Call before a VTT-originated Mongo write to suppress duplicate socket push. */
export function markCompendiumWritePending(): void {
  lastNotifiedMs = Date.now();
}

/** Suppress change-stream client pushes while bulk DDB import is running. */
export function beginCompendiumBulkImport(): void {
  bulkImportDepth += 1;
}

/** Resume change-stream pushes and notify clients once when the outermost import finishes. */
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

function onCollectionChange(
  collectionName: string,
  change: ChangeStreamDocument,
): void {
  const now = Date.now();
  if (bulkImportDepth > 0) return;
  if (now - lastNotifiedMs < SELF_ECHO_MS) return;

  const doc = 'fullDocument' in change ? change.fullDocument : undefined;
  const lastUpdated =
    collectionName === 'data' && doc && 'lastUpdated' in doc
      ? (doc as OwlbearRawGlobalDoc).lastUpdated ?? new Date()
      : new Date();
  scheduleChangeNotify(lastUpdated);
}

function attachCollectionWatch(collectionName: typeof WATCH_COLLECTIONS[number]): void {
  void (async () => {
    const col = await getCollection(collectionName);
    if (!col) {
      console.log(`[Compendium] Mongo watch skipped for ${collectionName} — no connection`);
      return;
    }

    const watch = () => {
      try {
        const pipeline =
          collectionName === 'data'
            ? [{ $match: { 'documentKey._id': 'global' } }]
            : [];
        const stream = col.watch(
          pipeline,
          collectionName === 'data' ? { fullDocument: 'updateLookup' } : {},
        );

        stream.on('change', (change: ChangeStreamDocument) => {
          onCollectionChange(collectionName, change);
        });

        stream.on('error', (err) => {
          console.warn(
            `[Compendium] Mongo change stream error (${collectionName}), reconnecting in 5s:`,
            err,
          );
          stream.close().catch(() => undefined);
          setTimeout(watch, 5_000);
        });

        console.log(`[Compendium] Mongo change stream active on ${collectionName}`);
      } catch (err) {
        console.warn(`[Compendium] Mongo watch failed (${collectionName}), retry in 5s:`, err);
        setTimeout(watch, 5_000);
      }
    };

    watch();
  })();
}

export function startCompendiumMongoWatch(): void {
  if (started || !isMongoConfigured()) return;
  started = true;

  for (const name of WATCH_COLLECTIONS) {
    attachCollectionWatch(name);
  }
}

/** Re-attach change streams after Mongo recovery (e.g. heal / circuit reset). */
export function resumeCompendiumMongoWatch(): void {
  if (!isMongoConfigured()) return;
  started = false;
  startCompendiumMongoWatch();
}
