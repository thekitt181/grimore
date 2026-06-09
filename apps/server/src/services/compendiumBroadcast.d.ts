import type { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@grimoire/shared';
export declare function setCompendiumSocketServer(server: Server<ClientToServerEvents, ServerToClientEvents>): void;
export declare function broadcastCompendiumUpdated(lastUpdated: string): void;
//# sourceMappingURL=compendiumBroadcast.d.ts.map