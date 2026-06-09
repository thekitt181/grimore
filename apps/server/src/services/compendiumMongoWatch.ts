import type { ChangeStreamDocument } from 'mongodb';
import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { getCollection, isMongoConfigured, isMongoCircuitOpen } from '../lib/mongo';
import { notifyCompendiumChanged } from './compendiumChangeNotify';

let started = false;
let lastNotifiedMs = 0;
/** Ignore change-stream echoes of our own write for this window (ms). */
const SELF_ECHO_MS = 400;

/** Call before a VTT-originated Mongo write to suppress duplicate socket push. */
export function markCompendiumWritePending(): void {
  lastNotifiedMs = Date.now();
}

export function startCompendiumMongoWatch(): void {
  if (started || !isMongoConfigured() || isMongoCircuitOpen()) return;
  started = true;

  void (async () => {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (!col) {
      console.log('[Compendium] Mongo watch skipped — no connection');
      return;
    }

    const watch = () => {
      try {
        const stream = col.watch(
          [{ $match: { 'documentKey._id': 'global' } }],
          { fullDocument: 'updateLookup' },
        );

        stream.on('change', (change: ChangeStreamDocument<OwlbearRawGlobalDoc>) => {
          const now = Date.now();
          if (now - lastNotifiedMs < SELF_ECHO_MS) return;

          const doc = 'fullDocument' in change ? change.fullDocument : undefined;
          const lastUpdated = doc?.lastUpdated ?? new Date();
          notifyCompendiumChanged(lastUpdated);
          console.log('[Compendium] Mongo change stream — clients notified');
        });

        stream.on('error', (err) => {
          console.warn('[Compendium] Mongo change stream error, reconnecting in 5s:', err);
          stream.close().catch(() => undefined);
          setTimeout(watch, 5_000);
        });

        console.log('[Compendium] Mongo change stream active (real-time extension ↔ VTT sync)');
      } catch (err) {
        console.warn('[Compendium] Mongo watch failed, retry in 5s:', err);
        setTimeout(watch, 5_000);
      }
    };

    watch();
  })();
}
