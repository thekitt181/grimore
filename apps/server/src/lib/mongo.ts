import dns from 'node:dns';
import { MongoClient, type Db, type Collection, type Document } from 'mongodb';

const DB_NAME = 'owlbear-extension';
const MONGO_OP_TIMEOUT_MS = 12_000;

// Some VPN/corporate DNS (e.g. 10.x resolvers) refuse SRV lookups for mongodb+srv URIs.
// Prefer public resolvers first so Atlas SRV records resolve reliably.
const systemDns = dns.getServers();
dns.setServers(
  systemDns.length > 0
    ? ['8.8.8.8', '1.1.1.1', ...systemDns.filter((s) => s !== '8.8.8.8' && s !== '1.1.1.1')]
    : ['8.8.8.8', '1.1.1.1'],
);

let client: MongoClient | null = null;
let db: Db | null = null;
let connectPromise: Promise<Db | null> | null = null;

export function isMongoConfigured(): boolean {
  return Boolean(process.env['MONGODB_URI']);
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
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  return (
    name.includes('MongoNetwork') ||
    name.includes('MongoServerSelection') ||
    name.includes('MongoNotConnected')
  );
}

export async function withMongoTimeout<T>(promise: Promise<T>, ms = MONGO_OP_TIMEOUT_MS): Promise<T> {
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

export async function getMongoDb(): Promise<Db | null> {
  const uri = process.env['MONGODB_URI'];
  if (!uri) return null;

  if (db) return db;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 15_000,
        socketTimeoutMS: 45_000,
        family: 4,
      });
      await client.connect();
      db = client.db(DB_NAME);
      console.log('[Mongo] Connected to', DB_NAME);
      return db;
    } catch (err) {
      console.error('[Mongo] Connection failed — compendium will use local JSON fallback if available:', err);
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
