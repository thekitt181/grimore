import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  setRoomUsers,
  getRoomUsers,
} from '../lib/redis';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  SessionUser,
  TokenMovePayload,
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
import { getClientOrigins } from '../lib/clientOrigins';

const clerk = createClerkClient({
  secretKey: process.env['CLERK_SECRET_KEY'] ?? '',
});

/** Per-session fog active flag (GM toggles off during prep). */
const sessionFogActive = new Map<string, boolean>();

export function initSocket(httpServer: HttpServer): Server {
  const allowedOrigins = getClientOrigins();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
      credentials: true,
    },
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    pingTimeout: 60_000,
    pingInterval: 25_000,
    connectTimeout: 60_000,
  });

  // ─── Auth middleware ─────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth['token'] as string | undefined;
      if (!token) return next(new Error('Missing auth token'));

      const payload = await verifyToken(token, {
        secretKey: process.env['CLERK_SECRET_KEY'] ?? '',
      });
      const clerkUserId = payload.sub;
      if (!clerkUserId) return next(new Error('Invalid token'));

      let user = await prisma.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true, username: true, avatarUrl: true },
      });

      if (!user) {
        const clerkUser = await clerk.users.getUser(clerkUserId);
        user = await prisma.user.create({
          data: {
            clerkId: clerkUserId,
            username:
              clerkUser.username ??
              clerkUser.firstName ??
              clerkUser.emailAddresses[0]?.emailAddress.split('@')[0] ??
              'Adventurer',
            avatarUrl: clerkUser.imageUrl ?? null,
          },
          select: { id: true, username: true, avatarUrl: true },
        });
      }

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

        const currentUsers = await getRoomUsers(sessionId);
        await setRoomUsers(sessionId, [...new Set([...currentUsers, userId])]);

        socket.to(sessionId).emit('session:userJoined', { sessionId, user: sessionUser });

        // Build and send room state to the newly joined user
        const allSocketIds = io.sockets.adapter.rooms.get(sessionId);
        const connectedUsers: SessionUser[] = [];

        if (allSocketIds) {
          for (const socketId of allSocketIds) {
            const s = io.sockets.sockets.get(socketId);
            if (!s?.data['userId']) continue;
            const uid = s.data['userId'] as string;
            const memberRecord = await prisma.campaignMember.findFirst({
              where: { campaignId, userId: uid },
              include: { campaign: { select: { gmId: true } } },
            });
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

        const fogActive = sessionFogActive.get(sessionId) ?? false;
        socket.emit('session:roomState', { users: connectedUsers, fogActive });

        // Scene items and fog are stored per-user in the browser — live sync only.
        socket.emit('fog:sync', { sessionId, fogData: '[]' });
        socket.emit('fog:active', { sessionId, active: fogActive });
        socket.emit('items:sync', { sessionId, items: [] });

        const ddbLink = await prisma.ddbCampaignLink.findUnique({ where: { campaignId } });
        if (ddbLink) {
          const bridgeUserId = await resolveRollBridgeUserId(campaignId);
          if (bridgeUserId) {
            void startRollBridge(io, sessionId, bridgeUserId, ddbLink.ddbCampaignId);
          } else {
            console.warn(
              '[DDB] roll bridge: campaign linked to DDB but GM has no linked account or roll bridge is off',
            );
          }
        }
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
      socket.to(payload.sessionId).emit('item:add', payload);
    });
    socket.on('item:update', (payload: ItemUpdatePayload) => {
      socket.to(payload.sessionId).emit('item:update', payload);
    });
    socket.on('item:remove', (payload: ItemRemovePayload) => {
      socket.to(payload.sessionId).emit('item:remove', payload);
    });
    socket.on('items:sync', (payload: ItemsSyncPayload) => {
      socket.to(payload.sessionId).emit('items:sync', payload);
    });

    // ── Map ──────────────────────────────────────────────────────────────────
    socket.on('map:tokenMove', (payload: TokenMovePayload) => {
      socket.to(payload.sessionId).emit('map:tokenMove', payload);
    });

    socket.on('map:fogUpdate', (payload: FogUpdatePayload) => {
      socket.to(payload.sessionId).emit('map:fogUpdate', payload);
    });

    socket.on('fog:sync', (payload: FogSyncPayload) => {
      socket.to(payload.sessionId).emit('fog:sync', payload);
    });

    socket.on('fog:active', (payload: FogActivePayload) => {
      if (socket.data['role'] !== 'GM') return;
      sessionFogActive.set(payload.sessionId, payload.active);
      socket.to(payload.sessionId).emit('fog:active', payload);
      socket.emit('fog:active', payload);
    });

    socket.on('map:gridUpdate', (payload) => {
      socket.to((payload as { sessionId: string }).sessionId).emit('map:gridUpdate', payload);
    });

    socket.on('map:mapMove', (payload: MapMovePayload) => {
      socket.to(payload.sessionId).emit('map:mapMove', payload);
    });
    socket.on('map:mapResize', (payload: MapResizePayload) => {
      socket.to(payload.sessionId).emit('map:mapResize', payload);
    });
    socket.on('map:mapLock', (payload: MapLockPayload) => {
      socket.to(payload.sessionId).emit('map:mapLock', payload);
    });
    socket.on('map:mapHide', (payload: MapHidePayload) => {
      socket.to(payload.sessionId).emit('map:mapHide', payload);
    });
    socket.on('map:mapDelete', (payload: MapDeletePayload) => {
      socket.to(payload.sessionId).emit('map:mapDelete', payload);
    });
    socket.on('map:gridStyle', (payload: MapGridStylePayload) => {
      socket.to(payload.sessionId).emit('map:gridStyle', payload);
    });
    socket.on('map:gridOffset', (payload: MapGridOffsetPayload) => {
      socket.to(payload.sessionId).emit('map:gridOffset', payload);
    });
    socket.on('map:tokenConditions', (payload: TokenConditionsPayload) => {
      socket.to(payload.sessionId).emit('map:tokenConditions', payload);
    });
    socket.on('map:tokenAura', (payload: TokenAuraPayload) => {
      socket.to(payload.sessionId).emit('map:tokenAura', payload);
    });

    // ── Drawing ──────────────────────────────────────────────────────────────
    socket.on('drawing:add', (payload: DrawingAddPayload) => {
      socket.to(payload.sessionId).emit('drawing:add', payload);
    });
    socket.on('drawing:remove', (payload: DrawingRemovePayload) => {
      socket.to(payload.sessionId).emit('drawing:remove', payload);
    });
    socket.on('drawing:clear', (payload: DrawingClearPayload) => {
      socket.to(payload.sessionId).emit('drawing:clear', payload);
    });

    // ── Initiative sync ──────────────────────────────────────────────────────
    socket.on('initiative:sync', (payload: InitiativeSyncPayload) => {
      io.to(payload.sessionId).emit('initiative:sync', payload);
    });

    // ── Combat ───────────────────────────────────────────────────────────────
    socket.on('combat:initiative', (payload: InitiativePayload) => {
      io.to(payload.sessionId).emit('combat:initiative', payload);
    });

    socket.on('combat:hpUpdate', (payload: HpUpdatePayload) => {
      io.to(payload.sessionId).emit('combat:hpUpdate', payload);
    });

    // ── Dice ─────────────────────────────────────────────────────────────────
    socket.on('dice:roll', async (payload: DiceRollPayload) => {
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
      io.to(payload.sessionId).emit('scene:change', payload);
    });

    // ── Handout ──────────────────────────────────────────────────────────────
    socket.on('handout:reveal', (payload: HandoutRevealPayload) => {
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
        socket.to(sessionId).emit('session:userLeft', { sessionId, userId });
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
  return io;
}
