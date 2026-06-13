import dns from 'node:dns';
import { MongoClient, type Db, type Collection, type Document } from 'mongodb';

const DB_NAME = 'owlbear-extension';
const MONGO_OP_TIMEOUT_MS = 8_000;
const CIRCUIT_FAIL_THRESHOLD = 2;
const CIRCUIT_OPEN_MS = 120_000;
const CLIENT_CLOSE_DELAY_MS = 10_000;

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
let lastConnectError: string | null = null;
/** While active, Mongo failures update health but do not open the circuit (heal / reconcile). */
let recoverySuppressUntil = 0;

function ensureMongoDns(): void {
  dns.setServers(['8.8.8.8', '1.1.1.1', ...dns.getServers().filter((s) => s !== '8.8.8.8' && s !== '1.1.1.1')]);
}

export function beginMongoRecoveryWindow(ms = 180_000): void {
  recoverySuppressUntil = Date.now() + ms;
  resetMongoCircuit('recovery-window');
}

export function endMongoRecoveryWindow(): void {
  recoverySuppressUntil = 0;
}

function isRecoveryWindowActive(): boolean {
  return Date.now() < recoverySuppressUntil;
}

export function getLastMongoConnectError(): string | null {
  return lastConnectError;
}

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

function scheduleClientClose(toClose: MongoClient): void {
  setTimeout(() => {
    void toClose.close().catch(() => undefined);
  }, CLIENT_CLOSE_DELAY_MS);
}

/** Drop cached Db handle without tearing down an in-use client pool. */
function softInvalidateMongoDb(): void {
  db = null;
  connectPromise = null;
}

function openMongoCircuit(reason: string): void {
  circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
  const now = Date.now();
  if (now - lastCircuitLogAt > 15_000) {
    lastCircuitLogAt = now;
    console.warn(`[Mongo] Circuit open (${CIRCUIT_OPEN_MS / 1000}s) — ${reason}`);
  }
  resetMongoClient(true);
}

function recordMongoSuccess(): void {
  const recovering = Date.now() < circuitOpenUntil;
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  lastConnectError = null;
  if (recovering) {
    void import('../services/compendiumFallbackMongoSync')
      .then(({ scheduleFallbackMongoSync }) => scheduleFallbackMongoSync('mongo-circuit-recovered'))
      .catch(() => undefined);
  }
}

function isMongoOperationTimeout(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Mongo operation timed out');
}

function isDisconnectedClientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = (err as Error).message ?? '';
  return msg.includes('Client must be connected')
    || msg.includes('Topology is closed')
    || msg.includes('connection closed')
    || msg.includes('Pool is closed');
}

function isRetryableMongoError(err: unknown): boolean {
  return isDisconnectedClientError(err) || isMongoOperationTimeout(err);
}

function recordMongoFailure(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  lastConnectError = msg;
  const now = new Date().toISOString();

  if (isDisconnectedClientError(err)) {
    softInvalidateMongoDb();
  }

  if (isMongoOperationTimeout(err)) {
    healthSnapshot = buildHealthSnapshot({
      state: 'degraded',
      lastCheckedAt: now,
      lastFailureAt: now,
      lastError: msg,
      latencyMs: null,
    });
    return;
  }

  consecutiveFailures += 1;
  healthSnapshot = buildHealthSnapshot({
    state: isMongoCircuitOpen() ? 'circuit-open' : 'unavailable',
    lastCheckedAt: now,
    lastFailureAt: now,
    lastError: msg,
    latencyMs: null,
  });
  if (isRecoveryWindowActive()) {
    return;
  }
  if (consecutiveFailures >= CIRCUIT_FAIL_THRESHOLD) {
    openMongoCircuit(msg);
  }
}

/** @param force When true, close the underlying client (heal, circuit reset, shutdown). */
export function resetMongoClient(force = false): void {
  softInvalidateMongoDb();
  if (force && client) {
    const toClose = client;
    client = null;
    scheduleClientClose(toClose);
  }
}

/** Clear the circuit breaker and drop the pooled client so the next op reconnects. */
export function resetMongoCircuit(reason?: string): void {
  const wasOpen = isMongoCircuitOpen();
  circuitOpenUntil = 0;
  consecutiveFailures = 0;
  resetMongoClient(true);
  if (wasOpen || reason) {
    console.log(`[Mongo] Circuit reset${reason ? ` (${reason})` : ''}`);
  }
}

function swapMongoClient(nextClient: MongoClient, database: Db): void {
  const previous = client;
  client = nextClient;
  db = database;
  connectPromise = null;
  if (previous && previous !== nextClient) {
    scheduleClientClose(previous);
  }
}

async function connectMongoDbWithRetries(maxAttempts = 3): Promise<Db | null> {
  ensureMongoDns();
  const uri = process.env['MONGODB_URI']!;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let probeClient: MongoClient | null = null;
    try {
      probeClient = new MongoClient(uri, {
        serverSelectionTimeoutMS: 12_000,
        socketTimeoutMS: 45_000,
        connectTimeoutMS: 12_000,
        maxPoolSize: Number(process.env['MONGODB_POOL_SIZE'] ?? 20),
        family: 4,
      });
      await probeClient.connect();
      const database = probeClient.db(DB_NAME);
      await database.command({ ping: 1 }, { timeoutMS: 5_000 });
      swapMongoClient(probeClient, database);
      recordMongoSuccess();
      return database;
    } catch (err) {
      lastErr = err;
      lastConnectError = err instanceof Error ? err.message : String(err);
      if (probeClient) {
        void probeClient.close().catch(() => undefined);
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    }
  }

  recordMongoFailure(lastErr);
  return null;
}

async function attachExistingClientDb(): Promise<Db | null> {
  if (!client) return null;
  try {
    const database = client.db(DB_NAME);
    await database.command({ ping: 1 }, { timeoutMS: 4_000 });
    db = database;
    recordMongoSuccess();
    return database;
  } catch (err) {
    lastConnectError = err instanceof Error ? err.message : String(err);
    resetMongoClient(true);
    return null;
  }
}

/** Manual / heal recovery — bypasses an open circuit and probes Mongo immediately. */
export async function attemptMongoRecovery(reason: string): Promise<MongoHealthSnapshot> {
  resetMongoCircuit(reason);
  ensureMongoDns();
  return pingMongo({ forceReconnect: true });
}

export function isMongoNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  return name.includes('MongoNetwork') || name.includes('MongoServerSelection') || name.includes('MongoTimeout');
}

/** Reset the client on connection failures — not on slow queries (timeouts). */
export function shouldResetMongoClient(err: unknown): boolean {
  if (isDisconnectedClientError(err)) return true;
  if (err instanceof Error && err.message.includes('timed out')) return false;
  return isMongoNetworkError(err);
}

async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Mongo operation timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type MongoWork<T> = (() => Promise<T>) | Promise<T>;

export async function withMongoTimeout<T>(work: MongoWork<T>, ms = MONGO_OP_TIMEOUT_MS): Promise<T> {
  if (isMongoCircuitOpen()) {
    throw new Error('MongoDB temporarily unavailable (circuit open)');
  }

  const canRetry = typeof work === 'function';
  const maxAttempts = canRetry ? 2 : 1;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const promise = typeof work === 'function' ? work() : work;
      const result = await raceWithTimeout(promise, ms);
      recordMongoSuccess();
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && canRetry && isRetryableMongoError(err)) {
        softInvalidateMongoDb();
        if (isDisconnectedClientError(err)) {
          resetMongoClient(true);
        }
        await getMongoDb();
        continue;
      }
      recordMongoFailure(err);
      throw err;
    }
  }

  recordMongoFailure(lastErr);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getMongoDb(): Promise<Db | null> {
  if (!isMongoConfigured() || isMongoCircuitOpen()) return null;

  if (db && client) return db;
  if (client && !db) {
    const attached = await attachExistingClientDb();
    if (attached) return attached;
  }
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      ensureMongoDns();
      const connected = await connectMongoDbWithRetries(3);
      if (connected) {
        console.log('[Mongo] Connected to', DB_NAME);
      } else {
        console.error(
          '[Mongo] Connection failed — compendium will use local JSON fallback:',
          lastConnectError ?? 'unknown error',
        );
      }
      return connected;
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
    return await withMongoTimeout(() => op(database));
  } catch (err) {
    if (shouldResetMongoClient(err)) {
      console.warn('[Mongo] Operation failed, resetting client:', err instanceof Error ? err.message : err);
      resetMongoClient(true);
    }
    throw err;
  }
}

export async function closeMongo(): Promise<void> {
  resetMongoClient(true);
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
    return buildHealthSnapshot({
      state: 'circuit-open',
      circuitOpen: true,
      lastError: lastConnectError ?? healthSnapshot.lastError,
    });
  }
  return healthSnapshot;
}

/** Active ping — updates health snapshot and may open/close the circuit via withMongoTimeout. */
export async function pingMongo(options?: { forceReconnect?: boolean }): Promise<MongoHealthSnapshot> {
  const now = new Date().toISOString();
  if (!isMongoConfigured()) {
    healthSnapshot = buildHealthSnapshot({ state: 'disabled', lastCheckedAt: now });
    await bumpSyncStatusOnHealthChange('disabled');
    return healthSnapshot;
  }
  if (isMongoCircuitOpen() && !options?.forceReconnect && !isRecoveryWindowActive()) {
    healthSnapshot = buildHealthSnapshot({
      state: 'circuit-open',
      lastCheckedAt: now,
      lastError: lastConnectError ?? healthSnapshot.lastError,
    });
    await bumpSyncStatusOnHealthChange('circuit-open');
    return healthSnapshot;
  }

  const started = Date.now();
  try {
    ensureMongoDns();
    const database = options?.forceReconnect
      ? await connectMongoDbWithRetries(3)
      : await getMongoDb();
    if (!database) {
      throw new Error(lastConnectError ?? 'MongoDB connection unavailable');
    }
    await withMongoTimeout(() => database.command({ ping: 1 }), 5_000);
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
