import Redis from 'ioredis';
export declare const redis: Redis;
export declare function setSessionState(sessionId: string, data: unknown): Promise<void>;
export declare function getSessionState<T>(sessionId: string): Promise<T | null>;
export declare function deleteSessionState(sessionId: string): Promise<void>;
export declare function setRoomUsers(sessionId: string, userIds: string[]): Promise<void>;
export declare function getRoomUsers(sessionId: string): Promise<string[]>;
export declare function setSessionFog(sessionId: string, fogData: string): Promise<void>;
export declare function getSessionFog(sessionId: string): Promise<string | null>;
export declare function setSessionItems(sessionId: string, itemsData: string): Promise<void>;
export declare function getSessionItems(sessionId: string): Promise<string | null>;
//# sourceMappingURL=redis.d.ts.map