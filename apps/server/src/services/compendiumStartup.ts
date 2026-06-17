import { pingCompendiumStorage, seedBundledCompendiumIfEmpty } from './compendiumPostgres';
import { startCompendiumMongoWatch } from './compendiumMongoWatch';
import { syncCompendiumStorageOnStartup } from './compendiumGlobal';
import { reconcileRawGlobalStorage } from './compendiumOwlbearPersist';
import { warmCompendiumCatalog } from './compendiumSync';
import { isDbPoolSaturation } from '../lib/dbTimeout';

const serverStartedAt = Date.now();
const RENDER_STARTUP_GUARD_MS = Number(process.env['COMPENDIUM_RENDER_GUARD_MS'] ?? 120_000);
const STARTUP_RETRY_MS = 90_000;
const POOL_SATURATION_RETRY_MS = Number(process.env['COMPENDIUM_POOL_RETRY_MS'] ?? 300_000);

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
let guardWaitPromise: Promise<void> | null = null;

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

function renderStartupGuardMs(): number {
  if (!isRenderDeploy()) return 0;
  return Math.max(0, RENDER_STARTUP_GUARD_MS - (Date.now() - serverStartedAt));
}

function waitForRenderStartupGuard(): Promise<void> {
  const delayMs = renderStartupGuardMs();
  if (delayMs <= 0) return Promise.resolve();
  if (!guardWaitPromise) {
    guardWaitPromise = new Promise((resolve) => {
      setTimeout(() => {
        guardWaitPromise = null;
        resolve();
      }, delayMs);
    });
  }
  return guardWaitPromise;
}

/** Fire-and-forget — used by sync-status so compendium init does not race session joins. */
export function scheduleCompendiumStartupBackground(): void {
  void ensureCompendiumStartup().catch((err) => {
    console.warn('[Compendium] Background startup failed:', err);
  });
}

/** Idempotent — safe to call from every compendium API request. */
export function ensureCompendiumStartup(): Promise<void> {
  if (startupDone) return Promise.resolve();
  if (Date.now() < startupFailedUntil) return Promise.resolve();

  if (!startupPromise) {
    startupPromise = waitForRenderStartupGuard()
      .then(() => runCompendiumStartup())
      .then(() => {
        startupDone = true;
      })
      .catch((err) => {
        startupPromise = null;
        const backoff = isDbPoolSaturation(err) ? POOL_SATURATION_RETRY_MS : STARTUP_RETRY_MS;
        startupFailedUntil = Date.now() + backoff;
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
