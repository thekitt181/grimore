import {
  invalidateExtensionGlobalCache,
  fetchExtensionVersion,
} from './compendiumExtensionBridge';
import {
  clearGlobalFallbackCache,
} from './compendiumGlobalFallback';
import { readMongoGlobalVersion, newestIso } from './compendiumGlobal';
import { isMongoCircuitOpen } from '../lib/mongo';
import { notifyCompendiumChanged } from './compendiumChangeNotify';

const POLL_MS = 30_000;

let lastMongoVersion = '';
let lastExtVersion = '';
let circuitWasOpen = false;
let started = false;

/** Backup poll for extension HTTP when Mongo change stream misses an update. */
export function startCompendiumExternalWatch(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      if (isMongoCircuitOpen()) {
        circuitWasOpen = true;
        return;
      }
      if (circuitWasOpen) {
        circuitWasOpen = false;
        const { scheduleFallbackMongoSync } = await import('./compendiumFallbackMongoSync');
        scheduleFallbackMongoSync('mongo-poll-recovered');
      }

      const mongoVersion = await readMongoGlobalVersion();
      const extVersion = await fetchExtensionVersion();

      const mongoChanged = Boolean(mongoVersion && mongoVersion !== lastMongoVersion);
      const extChanged = Boolean(extVersion && extVersion !== lastExtVersion);

      if (mongoChanged || extChanged) {
        invalidateExtensionGlobalCache();
        clearGlobalFallbackCache();
        notifyCompendiumChanged(newestIso(mongoVersion ?? undefined, extVersion ?? undefined));
        console.log('[Compendium] External change detected (poll backup), notifying clients');
      }

      if (mongoVersion) lastMongoVersion = mongoVersion;
      if (extVersion) lastExtVersion = extVersion;
    } catch (err) {
      console.error('[Compendium] External watch error:', err);
    }
  };

  void tick();
  setInterval(() => void tick(), POLL_MS);
}
