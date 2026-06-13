import type { ChangeStreamDocument } from 'mongodb';
import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { getCollection, isMongoConfigured, isMongoCircuitOpen } from '../lib/mongo';
import { notifyCompendiumChanged } from './compendiumChangeNotify';

const WATCH_COLLECTIONS = ['data', 'monsters', 'items', 'spells'] as const;

let started = false;
let lastNotifiedMs = 0;
/** Ignore change-stream echoes of our own write for this window (ms). */
const SELF_ECHO_MS = 400;

/** Call before a VTT-originated Mongo write to suppress duplicate socket push. */
export function markCompendiumWritePending(): void {
  lastNotifiedMs = Date.now();
}

function onCollectionChange(
  collectionName: string,
  change: ChangeStreamDocument,
): void {
  const now = Date.now();
  if (now - lastNotifiedMs < SELF_ECHO_MS) return;

  const doc = 'fullDocument' in change ? change.fullDocument : undefined;
  const lastUpdated =
    collectionName === 'data' && doc && 'lastUpdated' in doc
      ? (doc as OwlbearRawGlobalDoc).lastUpdated ?? new Date()
      : new Date();
  notifyCompendiumChanged(lastUpdated);
  console.log(`[Compendium] Mongo change stream (${collectionName}) — clients notified`);
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
  if (started || !isMongoConfigured() || isMongoCircuitOpen()) return;
  started = true;

  for (const name of WATCH_COLLECTIONS) {
    attachCollectionWatch(name);
  }
}
