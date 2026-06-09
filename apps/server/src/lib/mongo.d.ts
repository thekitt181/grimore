import { type Db, type Collection, type Document } from 'mongodb';
export declare function isMongoConfigured(): boolean;
export declare function resetMongoClient(): void;
export declare function isMongoNetworkError(err: unknown): boolean;
/** Reset the client only on connection failures — not on slow queries (timeouts). */
export declare function shouldResetMongoClient(err: unknown): boolean;
export declare function withMongoTimeout<T>(promise: Promise<T>, ms?: number): Promise<T>;
export declare function getMongoDb(): Promise<Db | null>;
export declare function getCollection<T extends Document = Document>(name: string): Promise<Collection<T> | null>;
export declare function runMongo<T>(op: (database: Db) => Promise<T>): Promise<T | null>;
export declare function closeMongo(): Promise<void>;
//# sourceMappingURL=mongo.d.ts.map