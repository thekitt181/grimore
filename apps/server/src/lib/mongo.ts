import dns from 'node:dns';
import { MongoClient, type Db, type Collection, type Document } from 'mongodb';

const DB_NAME = 'owlbear-extension';
const MONGO_OP_TIMEOUT_MS = 8_000;
const CIRCUIT_FAIL_THRESHOLD = 2;
const CIRCUIT_OPEN_MS = 120_000;

// Some VPN/corporate DNS (e.g. 10.x resolvers) refuse SRV lookups for mongodb+srv URIs.
dns.setServers(['8.8.8.8', '1.1.1.1', ...dns.getServers().filter((s) => s !== '8.8.8.8' && s !== '1.1.1.1')]);

let client: MongoClient | null = null;
let db: Db | null = null;
let connectPromise: Promise<Db | null> | null = null;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
let lastCircuitLogAt = 0;

export type MongoHealthState = 'disabled' | 'connected' | 'degraded' | 'circuit-open' | 'unavailable';

export interface MongoHealthSnapshot {
  state: MongoHealthState;
  configured: boolean;
  circuitOpen: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  latencyMs: number | null;
}

let healthSnapshot: MongoHealthSnapshot = {
  state: 'disabled',
  configured: false,
  circuitOpen: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  latencyMs: null,
};

let healthProbeStarted = false;
let lastHealthState: MongoHealthState = 'disabled';

export function isMongoConfigured(): boolean {
  return Boolean(process.env['MONGODB_URI']) && process.env['MONGODB_DISABLED'] !== '1';
}

export function isMongoCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

export function getMongoCircuitStatus(): { open: boolean; openUntil: number | null } {
  const open = isMongoCircuitOpen();
  return { open, openUntil: open ? circuitOpenUntil : null };
}

function openMongoCircuit(reason: string): void {
  circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
  const now = Date.now();
  if (now - lastCircuitLogAt > 15_000) {
    lastCircuitLogAt = now;
    console.warn(`[Mongo] Circuit open (${CIRCUIT_OPEN_MS / 1000}s) — ${reason}`);
  }
  resetMongoClient();
}

function recordMongoSuccess(): void {
  const recovering = Date.now() < circuitOpenUntil;
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  if (recovering) {
    void import('../services/compendiumFallbackMongoSync')
      .then(({ scheduleFallbackMongoSync }) => scheduleFallbackMongoSync('mongo-circuit-recovered'))
      .catch(() => undefined);
  }
}

function recordMongoFailure(err: unknown): void {
  consecutiveFailures += 1;
  const msg = err instanceof Error ? err.message : String(err);
  const network = isMongoNetworkError(err);
  // Require repeated failures — a single slow query must not trip the circuit.
  if (consecutiveFailures >= CIRCUIT_FAIL_THRESHOLD || network) {
    openMongoCircuit(msg);
  }
}

export function resetMongoClient(): void {
  if (client) {
    void client.close().catch(() => undefined);
  }
  client = null;
  db = null;
  connectPromise = null;
}

export function isMongoNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  return name.includes('MongoNetwork') || name.includes('MongoServerSelection') || name.includes('MongoTimeout');
}

/** Reset the client only on connection failures — not on slow queries (timeouts). */
export function shouldResetMongoClient(err: unknown): boolean {
  if (err instanceof Error && err.message.includes('timed out')) return false;
  return isMongoNetworkError(err);
}

export async function withMongoTimeout<T>(promise: Promise<T>, ms = MONGO_OP_TIMEOUT_MS): Promise<T> {
  if (isMongoCircuitOpen()) {
    throw new Error('MongoDB temporarily unavailable (circuit open)');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Mongo operation timed out after ${ms}ms`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    recordMongoSuccess();
    return result;
  } catch (err) {
    recordMongoFailure(err);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getMongoDb(): Promise<Db | null> {
  if (!isMongoConfigured() || isMongoCircuitOpen()) return null;

  if (db) return db;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const uri = process.env['MONGODB_URI']!;
    try {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 8_000,
        socketTimeoutMS: 20_000,
        connectTimeoutMS: 8_000,
        maxPoolSize: Number(process.env['MONGODB_POOL_SIZE'] ?? 20),
        family: 4,
      });
      await client.connect();
      db = client.db(DB_NAME);
      console.log('[Mongo] Connected to', DB_NAME);
      recordMongoSuccess();
      return db;
    } catch (err) {
      console.error('[Mongo] Connection failed — compendium will use local JSON fallback:', err);
      recordMongoFailure(err);
      resetMongoClient();
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

export async function getCollection<T extends Document = Document>(
  name: string,
): Promise<Collection<T> | null> {
  if (isMongoCircuitOpen()) return null;
  const database = await getMongoDb();
  return database ? database.collection<T>(name) : null;
}

export async function runMongo<T>(op: (database: Db) => Promise<T>): Promise<T | null> {
  const database = await getMongoDb();
  if (!database) return null;
  try {
    return await withMongoTimeout(op(database));
  } catch (err) {
    if (shouldResetMongoClient(err)) {
      console.warn('[Mongo] Operation failed, resetting client:', err instanceof Error ? err.message : err);
      resetMongoClient();
    }
    throw err;
  }
}

export async function closeMongo(): Promise<void> {
  resetMongoClient();
}

function buildHealthSnapshot(partial: Partial<MongoHealthSnapshot>): MongoHealthSnapshot {
  const configured = isMongoConfigured();
  const circuitOpen = isMongoCircuitOpen();
  return {
    state: partial.state ?? (configured ? (circuitOpen ? 'circuit-open' : 'unavailable') : 'disabled'),
    configured,
    circuitOpen,
    lastCheckedAt: partial.lastCheckedAt ?? healthSnapshot.lastCheckedAt,
    lastSuccessAt: partial.lastSuccessAt ?? healthSnapshot.lastSuccessAt,
    lastFailureAt: partial.lastFailureAt ?? healthSnapshot.lastFailureAt,
    lastError: partial.lastError ?? healthSnapshot.lastError,
    latencyMs: partial.latencyMs ?? healthSnapshot.latencyMs,
  };
}

async function bumpSyncStatusOnHealthChange(nextState: MongoHealthState): Promise<void> {
  if (nextState === lastHealthState) return;
  lastHealthState = nextState;
  try {
    const { bumpCompendiumSyncStatusCache } = await import('../services/compendiumSync');
    bumpCompendiumSyncStatusCache();
  } catch {
    // compendium may not be loaded yet during startup
  }
}

export function getMongoHealthSnapshot(): MongoHealthSnapshot {
  if (!isMongoConfigured()) {
    return buildHealthSnapshot({ state: 'disabled', circuitOpen: false });
  }
  if (isMongoCircuitOpen()) {
    return buildHealthSnapshot({ state: 'circuit-open', circuitOpen: true });
  }
  return healthSnapshot;
}

/** Active ping — updates health snapshot and may open/close the circuit via withMongoTimeout. */
export async function pingMongo(): Promise<MongoHealthSnapshot> {
  const now = new Date().toISOString();
  if (!isMongoConfigured()) {
    healthSnapshot = buildHealthSnapshot({ state: 'disabled', lastCheckedAt: now });
    await bumpSyncStatusOnHealthChange('disabled');
    return healthSnapshot;
  }
  if (isMongoCircuitOpen()) {
    healthSnapshot = buildHealthSnapshot({
      state: 'circuit-open',
      lastCheckedAt: now,
      lastError: healthSnapshot.lastError,
    });
    await bumpSyncStatusOnHealthChange('circuit-open');
    return healthSnapshot;
  }

  const started = Date.now();
  try {
    const database = await getMongoDb();
    if (!database) {
      throw new Error('MongoDB connection unavailable');
    }
    await withMongoTimeout(database.command({ ping: 1 }), 5_000);
    const latencyMs = Date.now() - started;
    healthSnapshot = buildHealthSnapshot({
      state: 'connected',
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastError: null,
      latencyMs,
    });
    await bumpSyncStatusOnHealthChange('connected');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    healthSnapshot = buildHealthSnapshot({
      state: isMongoCircuitOpen() ? 'circuit-open' : 'unavailable',
      lastCheckedAt: now,
      lastFailureAt: now,
      lastError: msg,
      latencyMs: null,
    });
    await bumpSyncStatusOnHealthChange(healthSnapshot.state);
  }
  return healthSnapshot;
}

export function startMongoHealthProbe(intervalMs = 20_000): void {
  if (healthProbeStarted || !isMongoConfigured()) return;
  healthProbeStarted = true;
  const ms = Math.max(5_000, intervalMs);
  void pingMongo();
  setInterval(() => {
    void pingMongo();
  }, ms);
  console.log(`[Mongo] Health probe active (every ${ms / 1000}s)`);
}
