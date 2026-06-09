import dns from 'node:dns';
import { MongoClient } from 'mongodb';
const DB_NAME = 'owlbear-extension';
const MONGO_OP_TIMEOUT_MS = 6_000;
// Some VPN/corporate DNS (e.g. 10.x resolvers) refuse Node SRV lookups for mongodb+srv URIs.
const systemDns = dns.getServers();
dns.setServers(systemDns.length > 0 ? [...systemDns, '8.8.8.8', '1.1.1.1'] : ['8.8.8.8', '1.1.1.1']);
let client = null;
let db = null;
let connectPromise = null;
export function isMongoConfigured() {
    return Boolean(process.env['MONGODB_URI']);
}
export function resetMongoClient() {
    if (client) {
        void client.close().catch(() => undefined);
    }
    client = null;
    db = null;
    connectPromise = null;
}
export function isMongoNetworkError(err) {
    if (!err || typeof err !== 'object')
        return false;
    const name = err.name ?? '';
    return name.includes('MongoNetwork') || name.includes('MongoServerSelection') || name.includes('MongoTimeout');
}
/** Reset the client only on connection failures — not on slow queries (timeouts). */
export function shouldResetMongoClient(err) {
    if (err instanceof Error && err.message.includes('timed out'))
        return false;
    if (!err || typeof err !== 'object')
        return false;
    const name = err.name ?? '';
    return (name.includes('MongoNetwork') ||
        name.includes('MongoServerSelection') ||
        name.includes('MongoNotConnected'));
}
export async function withMongoTimeout(promise, ms = MONGO_OP_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Mongo operation timed out after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
export async function getMongoDb() {
    const uri = process.env['MONGODB_URI'];
    if (!uri)
        return null;
    if (db)
        return db;
    if (connectPromise)
        return connectPromise;
    connectPromise = (async () => {
        try {
            client = new MongoClient(uri, {
                serverSelectionTimeoutMS: 8_000,
                socketTimeoutMS: 10_000,
                family: 4,
            });
            await client.connect();
            db = client.db(DB_NAME);
            console.log('[Mongo] Connected to', DB_NAME);
            return db;
        }
        catch (err) {
            console.error('[Mongo] Connection failed — compendium will use local JSON fallback if available:', err);
            resetMongoClient();
            return null;
        }
        finally {
            connectPromise = null;
        }
    })();
    return connectPromise;
}
export async function getCollection(name) {
    const database = await getMongoDb();
    return database ? database.collection(name) : null;
}
export async function runMongo(op) {
    const database = await getMongoDb();
    if (!database)
        return null;
    try {
        return await withMongoTimeout(op(database));
    }
    catch (err) {
        if (shouldResetMongoClient(err)) {
            console.warn('[Mongo] Operation failed, resetting client:', err instanceof Error ? err.message : err);
            resetMongoClient();
        }
        throw err;
    }
}
export async function closeMongo() {
    resetMongoClient();
}
//# sourceMappingURL=mongo.js.map