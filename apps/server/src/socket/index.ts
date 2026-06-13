import type { Server as HttpServer } from 'http';
import type { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { getAuthUserIdFromRequest } from '../lib/sessionAuth';
import { resolveAuthUser } from '../lib/authUserCache';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  setRoomUsers,
  getRoomUsers,
  getSessionFog,
  getSessionItems,
  setSessionItems,
} from '../lib/redis';
import {
  dedupeSessionUsers,
  type ServerToClientEvents,
  type ClientToServerEvents,
  type SessionUser,
  TokenMovePayload,
  TokenPlacePayload,
  TokenHpPayload,
  TokenTypePayload,
  TokenRotatePayload,
  TokenHidePayload,
  TokenDeletePayload,
  TokenConditionPayload,
  FogUpdatePayload,
  FogSyncPayload,
  FogActivePayload,
  MapMovePayload,
  MapResizePayload,
  MapLockPayload,
  MapHidePayload,
  MapDeletePayload,
  MapGridStylePayload,
  MapGridOffsetPayload,
  ItemAddPayload,
  ItemUpdatePayload,
  ItemRemovePayload,
  ItemsSyncPayload,
  TokenConditionsPayload,
  TokenAuraPayload,
  DrawingAddPayload,
  DrawingRemovePayload,
  DrawingClearPayload,
  InitiativeSyncPayload,
  InitiativePayload,
  HpUpdatePayload,
  DiceRollPayload,
  SceneChangePayload,
  HandoutRevealPayload,
  ChatMessagePayload,
} from '@grimoire/shared';
import { setCompendiumSocketServer } from '../services/compendiumBroadcast';
import { startRollBridge, stopRollBridge, isRollBridgeActive, resolveRollBridgeUserId } from '../services/ddb/ddbRollBridge';
import { persistSessionFogCache } from '../lib/fogSessionCache';
import { isClientOriginAllowed } from '../lib/clientOrigins';

/** Per-session fog active flag (GM toggles off during prep). */
const sessionFogActive = new Map<string, boolean>();

function isJoinedSession(socket: Socket, sessionId: string): boolean {
  return socket.data['sessionId'] === sessionId;
}

function isSessionGM(socket: Socket): boolean {
  return socket.data['role'] === 'GM';
}

async function hydrateSessionFromCache(socket: Socket, sessionId: string): Promise<void> {
  const [cachedFog, cachedItemsRaw] = await Promise.all([
    getSessionFog(sessionId),
    getSessionItems(sessionId),
  ]);

  socket.emit('fog:sync', { sessionId, fogData: cachedFog ?? '[]' });

  if (cachedItemsRaw) {
    try {
      const items = JSON.parse(cachedItemsRaw) as unknown;
      if (Array.isArray(items)) {
        socket.emit('items:sync', { sessionId, items });
        return;
      }
    } catch {
      /* fall through */
    }
  }
  socket.emit('items:sync', { sessionId, items: [] });
}

function cacheSessionFog(
  sessionId: string,
  payload: { fogData?: string; added?: string[]; removed?: string[] },
): void {
  void persistSessionFogCache(sessionId, payload);
}

function cacheSessionItems(sessionId: string, items: unknown[]): void {
  void setSessionItems(sessionId, JSON.stringify(items));
}

function userHasOtherSocketInRoom(
  io: Server,
  sessionId: string,
  userId: string,
  exceptSocketId: string,
): boolean {
  const room = io.sockets.adapter.rooms.get(sessionId);
  if (!room) return false;
  for (const socketId of room) {
    if (socketId === exceptSocketId) continue;
    const peer = io.sockets.sockets.get(socketId);
    if (peer?.data['userId'] === userId) return true;
  }
  return false;
}

export function initSocket(httpServer: HttpServer): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isClientOriginAllowed(origin)) {
          callback(null, true);
        } else {
          console.warn(`[Socket] CORS blocked origin: ${origin ?? '(none)'}`);
          callback(new Error('CORS blocked'));
        }
      },
      credentials: true,
    },
    transports: ['polling', 'websocket'],
    pingTimeout: 120_000,
    pingInterval: 25_000,
    connectTimeout: 90_000,
    maxHttpBufferSize: 1e7,
  });

  // ─── Auth middleware ─────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth['token'] as string | undefined;
      const authUserId = await getAuthUserIdFromRequest(socket.request.headers, token);
      if (!authUserId) return next(new Error('Missing auth token'));

      const user = await resolveAuthUser(authUserId);

      socket.data['userId'] = user.id;
      socket.data['username'] = user.username;
      socket.data['avatarUrl'] = user.avatarUrl ?? undefined;

      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  // ─── Connection handler ──────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.data['userId'] as string;
    const username = socket.data['username'] as string;

    console.log(`[Socket] User ${username} (${userId}) connected`);

    // ── Join session room ────────────────────────────────────────────────────
    socket.on('session:join', async ({ sessionId, campaignId }) => {
      try {
        const member = await prisma.campaignMember.findFirst({
          where: { campaignId, userId },
          include: { campaign: { select: { gmId: true } } },
        });

        if (!member) {
          socket.emit('error', { message: 'Not a member of this campaign' });
          return;
        }

        const role: 'GM' | 'PLAYER' = member.campaign.gmId === userId ? 'GM' : 'PLAYER';
        const avatarUrl = socket.data['avatarUrl'] as string | undefined;
        const sessionUser: SessionUser = { id: userId, username, avatarUrl, role };

        socket.join(sessionId);
        socket.data['sessionId'] = sessionId;
        socket.data['role'] = role;

        const fogActive = sessionFogActive.get(sessionId) ?? false;

        // Fast ack — client shows Live before slower roster / DDB work.
        socket.emit('session:roomState', { users: [sessionUser], fogActive });
        socket.emit('fog:active', { sessionId, active: fogActive });
        void hydrateSessionFromCache(socket, sessionId);

        void getRoomUsers(sessionId)
          .then((currentUsers) => setRoomUsers(sessionId, [...new Set([...currentUsers, userId])]))
          .catch((redisErr) => console.warn('[Socket] Redis room tracking skipped:', redisErr));

        if (!userHasOtherSocketInRoom(io, sessionId, userId, socket.id)) {
          socket.to(sessionId).emit('session:userJoined', { sessionId, user: sessionUser });
        }

        // Refresh full online roster (non-blocking for join ack).
        try {
          const allSocketIds = io.sockets.adapter.rooms.get(sessionId);
          const connectedUsers: SessionUser[] = [];

          if (allSocketIds) {
            const uidBySocket = new Map<string, string>();
            const uniqueUserIds = new Set<string>();
            for (const socketId of allSocketIds) {
              const s = io.sockets.sockets.get(socketId);
              const uid = s?.data['userId'] as string | undefined;
              if (!uid) continue;
              uidBySocket.set(socketId, uid);
              uniqueUserIds.add(uid);
            }

            if (uniqueUserIds.size > 0) {
              const memberRecords = await prisma.campaignMember.findMany({
                where: { campaignId, userId: { in: [...uniqueUserIds] } },
                include: { campaign: { select: { gmId: true } } },
              });
              const memberByUserId = new Map(memberRecords.map((m) => [m.userId, m]));

              for (const socketId of allSocketIds) {
                const s = io.sockets.sockets.get(socketId);
                const uid = uidBySocket.get(socketId);
                if (!s || !uid) continue;
                const memberRecord = memberByUserId.get(uid);
                if (memberRecord) {
                  connectedUsers.push({
                    id: uid,
                    username: s.data['username'] as string,
                    avatarUrl: s.data['avatarUrl'] as string | undefined,
                    role: memberRecord.campaign.gmId === uid ? 'GM' : 'PLAYER',
                  });
                }
              }
            }
          }

          const roster = dedupeSessionUsers(
            connectedUsers.length > 0 ? connectedUsers : [sessionUser],
          );
          socket.emit('session:roomState', { users: roster, fogActive });
        } catch (rosterErr) {
          console.warn('[Socket] room roster refresh failed:', rosterErr);
        }

        void (async () => {
          try {
            const ddbLink = await prisma.ddbCampaignLink.findUnique({ where: { campaignId } });
            if (!ddbLink) return;
            const bridgeUserId = await resolveRollBridgeUserId(campaignId);
            if (bridgeUserId) {
              void startRollBridge(io, sessionId, bridgeUserId, ddbLink.ddbCampaignId);
            } else {
              console.warn(
                '[DDB] roll bridge: campaign linked to DDB but GM has no linked account or roll bridge is off',
              );
            }
          } catch (ddbErr) {
            console.warn('[Socket] DDB bridge setup failed:', ddbErr);
          }
        })();
      } catch (err) {
        console.error('[Socket] session:join error:', err);
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    socket.on('session:leave', ({ sessionId }) => {
      socket.leave(sessionId);
      socket.to(sessionId).emit('session:userLeft', { sessionId, userId });
    });

    // ── Generic scene items (unified editor) — relay only; clients persist locally ──
    socket.on('item:add', (payload: ItemAddPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('item:add', payload);
    });
    socket.on('item:update', (payload: ItemUpdatePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('item:update', payload);
    });
    socket.on('item:remove', (payload: ItemRemovePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('item:remove', payload);
    });
    socket.on('items:sync', (payload: ItemsSyncPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      if (isSessionGM(socket)) {
        cacheSessionItems(payload.sessionId, payload.items);
      }
      socket.to(payload.sessionId).emit('items:sync', payload);
    });

    const relayToken = <T extends { sessionId: string }>(event: string) => {
      socket.on(event as any, (payload: T) => {
        if (!isJoinedSession(socket, payload.sessionId)) return;
        socket.to(payload.sessionId).emit(event as any, payload);
      });
    };
    relayToken<TokenPlacePayload>('token:place');
    relayToken<TokenMovePayload>('token:move');
    relayToken<TokenHpPayload>('token:hp');
    relayToken<TokenTypePayload>('token:type');
    relayToken<TokenRotatePayload>('token:rotate');
    relayToken<TokenHidePayload>('token:hide');
    relayToken<TokenDeletePayload>('token:delete');
    relayToken<TokenConditionPayload>('token:condition');

    // ── Map ──────────────────────────────────────────────────────────────────
    socket.on('map:tokenMove', (payload: TokenMovePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:tokenMove', payload);
    });

    socket.on('map:fogUpdate', (payload: FogUpdatePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      if (isSessionGM(socket)) {
        cacheSessionFog(payload.sessionId, payload);
      }
      socket.to(payload.sessionId).emit('map:fogUpdate', payload);
    });

    socket.on('fog:sync', (payload: FogSyncPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      if (isSessionGM(socket)) {
        cacheSessionFog(payload.sessionId, { fogData: payload.fogData });
      }
      socket.to(payload.sessionId).emit('fog:sync', payload);
    });

    socket.on('fog:active', (payload: FogActivePayload) => {
      if (socket.data['role'] !== 'GM') return;
      sessionFogActive.set(payload.sessionId, payload.active);
      socket.to(payload.sessionId).emit('fog:active', payload);
      socket.emit('fog:active', payload);
    });

    socket.on('map:gridUpdate', (payload) => {
      const sessionId = (payload as { sessionId: string }).sessionId;
      if (!isJoinedSession(socket, sessionId)) return;
      socket.to(sessionId).emit('map:gridUpdate', payload);
    });

    socket.on('map:mapMove', (payload: MapMovePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:mapMove', payload);
    });
    socket.on('map:mapResize', (payload: MapResizePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:mapResize', payload);
    });
    socket.on('map:mapLock', (payload: MapLockPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:mapLock', payload);
    });
    socket.on('map:mapHide', (payload: MapHidePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:mapHide', payload);
    });
    socket.on('map:mapDelete', (payload: MapDeletePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:mapDelete', payload);
    });
    socket.on('map:gridStyle', (payload: MapGridStylePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:gridStyle', payload);
    });
    socket.on('map:gridOffset', (payload: MapGridOffsetPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:gridOffset', payload);
    });
    socket.on('map:tokenConditions', (payload: TokenConditionsPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:tokenConditions', payload);
    });
    socket.on('map:tokenAura', (payload: TokenAuraPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('map:tokenAura', payload);
    });

    // ── Drawing ──────────────────────────────────────────────────────────────
    socket.on('drawing:add', (payload: DrawingAddPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('drawing:add', payload);
    });
    socket.on('drawing:remove', (payload: DrawingRemovePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('drawing:remove', payload);
    });
    socket.on('drawing:clear', (payload: DrawingClearPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      socket.to(payload.sessionId).emit('drawing:clear', payload);
    });

    // ── Initiative sync ──────────────────────────────────────────────────────
    socket.on('initiative:sync', (payload: InitiativeSyncPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      io.to(payload.sessionId).emit('initiative:sync', payload);
    });

    // ── Combat ───────────────────────────────────────────────────────────────
    socket.on('combat:initiative', (payload: InitiativePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      io.to(payload.sessionId).emit('combat:initiative', payload);
    });

    socket.on('combat:hpUpdate', (payload: HpUpdatePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      io.to(payload.sessionId).emit('combat:hpUpdate', payload);
    });

    // ── Dice ─────────────────────────────────────────────────────────────────
    socket.on('dice:roll', async (payload: DiceRollPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      if (payload.isSecret) {
        const room = io.sockets.adapter.rooms.get(payload.sessionId);
        if (room) {
          for (const socketId of room) {
            const s = io.sockets.sockets.get(socketId);
            if (s?.data['role'] === 'GM') {
              s.emit('dice:roll', payload);
            } else if (s) {
              s.emit('dice:roll', {
                ...payload,
                secretHidden: true,
                results: [],
                usedResults: [],
                droppedResults: [],
                total: 0,
                isCrit: false,
                isCritFail: false,
                notation: payload.notation,
              });
            }
          }
        }
      } else {
        io.to(payload.sessionId).emit('dice:roll', payload);
      }

      try {
        await prisma.sessionLog.create({
          data: {
            sessionId: payload.sessionId,
            userId: payload.rollerId || undefined,
            type: 'DICE_ROLL',
            // Prisma Json field requires casting through unknown
            data: payload as unknown as Prisma.InputJsonValue,
          },
        });
      } catch {
        // Non-critical — log silently
      }
    });

    // ── Scene ────────────────────────────────────────────────────────────────
    socket.on('scene:change', (payload: SceneChangePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      io.to(payload.sessionId).emit('scene:change', payload);
    });

    // ── Handout ──────────────────────────────────────────────────────────────
    socket.on('handout:reveal', (payload: HandoutRevealPayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      if (payload.targetUserIds === 'all') {
        io.to(payload.sessionId).emit('handout:reveal', payload);
      } else {
        const room = io.sockets.adapter.rooms.get(payload.sessionId);
        const targets = payload.targetUserIds as string[];
        if (room) {
          for (const socketId of room) {
            const s = io.sockets.sockets.get(socketId);
            if (s && targets.includes(s.data['userId'] as string)) {
              s.emit('handout:reveal', payload);
            }
          }
        }
      }
    });

    // ── D&D Beyond roll bridge ───────────────────────────────────────────────
    socket.on('ddb:rollBridge:start', async ({ sessionId, ddbCampaignId }) => {
      try {
        const gameSession = await prisma.gameSession.findUnique({
          where: { id: sessionId },
          select: { campaignId: true },
        });
        const bridgeUserId = gameSession
          ? (await resolveRollBridgeUserId(gameSession.campaignId)) ?? userId
          : userId;
        await startRollBridge(io, sessionId, bridgeUserId, ddbCampaignId);
        socket.emit('ddb:rollBridge:status', {
          sessionId,
          connected: isRollBridgeActive(sessionId),
          ddbCampaignId,
        });
      } catch (err) {
        console.error('[DDB] roll bridge start failed:', err);
        socket.emit('ddb:rollBridge:status', {
          sessionId,
          connected: false,
          error: err instanceof Error ? err.message : 'Start failed',
        });
      }
    });

    socket.on('ddb:rollBridge:stop', ({ sessionId }) => {
      stopRollBridge(sessionId, userId);
    });

    // ── Chat ─────────────────────────────────────────────────────────────────
    socket.on('chat:message', async (payload: ChatMessagePayload) => {
      if (!isJoinedSession(socket, payload.sessionId)) return;
      if (payload.whisperToId) {
        const room = io.sockets.adapter.rooms.get(payload.sessionId);
        if (room) {
          for (const socketId of room) {
            const s = io.sockets.sockets.get(socketId);
            if (
              s &&
              (s.data['userId'] === payload.whisperToId ||
                s.data['userId'] === payload.senderId)
            ) {
              s.emit('chat:message', payload);
            }
          }
        }
      } else {
        io.to(payload.sessionId).emit('chat:message', payload);
      }

      try {
        await prisma.chatMessage.create({
          data: {
            id: payload.id,
            sessionId: payload.sessionId,
            senderId: payload.senderId,
            type: payload.type,
            content: payload.content,
            rollData: payload.roll ? (payload.roll as unknown as Prisma.InputJsonValue) : undefined,
            whisperToId: payload.whisperToId ?? null,
            timestamp: new Date(payload.timestamp),
          },
        });
      } catch {
        // Non-critical
      }
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const sessionId = socket.data['sessionId'] as string | undefined;
      if (sessionId) {
        if (!userHasOtherSocketInRoom(io, sessionId, userId, socket.id)) {
          socket.to(sessionId).emit('session:userLeft', { sessionId, userId });
        }
        // Keep roll bridge alive while anyone is still in the session.
        setTimeout(() => {
          const room = io.sockets.adapter.rooms.get(sessionId);
          if (!room || room.size === 0) stopRollBridge(sessionId);
        }, 250);
      }
      console.log(`[Socket] User ${username} disconnected`);
    });
  });

  setCompendiumSocketServer(io);
  socketServer = io;
  return io;
}

let socketServer: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

export function getSocketServer(): Server<ClientToServerEvents, ServerToClientEvents> | null {
  return socketServer;
}
