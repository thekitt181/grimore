import { pingCompendiumStorage, seedBundledCompendiumIfEmpty } from './compendiumPostgres';
import { startCompendiumMongoWatch } from './compendiumMongoWatch';
import { syncCompendiumStorageOnStartup } from './compendiumGlobal';
import { reconcileRawGlobalStorage } from './compendiumOwlbearPersist';
import { warmCompendiumCatalog } from './compendiumSync';

function isRenderDeploy(): boolean {
  return process.env['RENDER'] === 'true' || Boolean(process.env['RENDER_SERVICE_ID']);
}

export function shouldAutoStartCompendium(): boolean {
  if (process.env['COMPENDIUM_STARTUP'] === '1') return true;
  if (process.env['SKIP_COMPENDIUM_STARTUP'] === '1') return false;
  return !isRenderDeploy();
}

let startupPromise: Promise<void> | null = null;
let startupDone = false;
let startupFailedUntil = 0;

const STARTUP_RETRY_MS = 90_000;

async function runCompendiumStartup(): Promise<void> {
  try {
    const { warmBookSourcesCacheFromDisk } = await import('./compendiumBookSourcesCache');
    warmBookSourcesCacheFromDisk();
    await pingCompendiumStorage();
    const seeded = await seedBundledCompendiumIfEmpty();
    if (seeded.seeded) {
      console.log(
        `[Compendium] Seeded bundled catalog to Postgres (${seeded.counts.monsters} monsters, ${seeded.counts.items} items, ${seeded.counts.spells} spells)`,
      );
    }
    await syncCompendiumStorageOnStartup();
    const { ensureBundledSourcesLocked, ensureImportedSourcesUnlocked } = await import('./compendiumBundledLock');
    await ensureBundledSourcesLocked('startup');
    await ensureImportedSourcesUnlocked('startup');
    startCompendiumMongoWatch();
    console.log('[Compendium] PostgreSQL storage ready');
  } catch (err) {
    console.error('[Compendium] Startup failed:', err);
    throw err;
  }
  void reconcileRawGlobalStorage();
}

/** Idempotent — safe to call from every compendium API request. */
export function ensureCompendiumStartup(): Promise<void> {
  if (startupDone) return Promise.resolve();
  if (Date.now() < startupFailedUntil) return Promise.resolve();

  if (!startupPromise) {
    startupPromise = runCompendiumStartup()
      .then(() => {
        startupDone = true;
      })
      .catch((err) => {
        startupPromise = null;
        startupFailedUntil = Date.now() + STARTUP_RETRY_MS;
        throw err;
      });
  }
  return startupPromise;
}

function scheduleCompendiumCatalogWarm(): void {
  const delayMs = Number(process.env['COMPENDIUM_WARM_DELAY_MS'] ?? 360_000);
  setTimeout(() => {
    void warmCompendiumCatalog().catch((err) => {
      console.warn('[Compendium] Catalog warm failed:', err);
    });
  }, delayMs);
}

export function scheduleCompendiumJobs(): void {
  if (!shouldAutoStartCompendium()) {
    console.log('[Compendium] Startup deferred until first /api/compendium request');
    return;
  }

  const delayMs = Number(process.env['COMPENDIUM_STARTUP_DELAY_MS'] ?? 180_000);
  setTimeout(() => {
    void ensureCompendiumStartup().catch((err) => {
      console.error('[Compendium] Scheduled startup failed:', err);
    });
  }, delayMs);
  scheduleCompendiumCatalogWarm();
}
