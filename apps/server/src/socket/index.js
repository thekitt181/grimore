import { Server } from 'socket.io';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { prisma } from '../lib/prisma';
import { setRoomUsers, getRoomUsers, } from '../lib/redis';
import { setCompendiumSocketServer } from '../services/compendiumBroadcast';
const clerk = createClerkClient({
    secretKey: process.env['CLERK_SECRET_KEY'] ?? '',
});
export function initSocket(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: process.env['CLIENT_URL'] ?? 'http://localhost:5173',
            credentials: true,
        },
        transports: ['websocket', 'polling'],
    });
    // ─── Auth middleware ─────────────────────────────────────────────────────────
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth['token'];
            if (!token)
                return next(new Error('Missing auth token'));
            const payload = await verifyToken(token, {
                secretKey: process.env['CLERK_SECRET_KEY'] ?? '',
            });
            const clerkUserId = payload.sub;
            if (!clerkUserId)
                return next(new Error('Invalid token'));
            const user = await prisma.user.findUnique({
                where: { clerkId: clerkUserId },
                select: { id: true, username: true, avatarUrl: true },
            });
            if (!user)
                return next(new Error('User not found'));
            socket.data['userId'] = user.id;
            socket.data['username'] = user.username;
            socket.data['avatarUrl'] = user.avatarUrl ?? undefined;
            next();
        }
        catch (err) {
            next(new Error('Authentication failed'));
        }
    });
    // ─── Connection handler ──────────────────────────────────────────────────────
    io.on('connection', (socket) => {
        const userId = socket.data['userId'];
        const username = socket.data['username'];
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
                const role = member.campaign.gmId === userId ? 'GM' : 'PLAYER';
                const avatarUrl = socket.data['avatarUrl'];
                const sessionUser = { id: userId, username, avatarUrl, role };
                socket.join(sessionId);
                socket.data['sessionId'] = sessionId;
                socket.data['role'] = role;
                const currentUsers = await getRoomUsers(sessionId);
                await setRoomUsers(sessionId, [...new Set([...currentUsers, userId])]);
                socket.to(sessionId).emit('session:userJoined', { sessionId, user: sessionUser });
                // Build and send room state to the newly joined user
                const allSocketIds = io.sockets.adapter.rooms.get(sessionId);
                const connectedUsers = [];
                if (allSocketIds) {
                    for (const socketId of allSocketIds) {
                        const s = io.sockets.sockets.get(socketId);
                        if (!s?.data['userId'])
                            continue;
                        const uid = s.data['userId'];
                        const memberRecord = await prisma.campaignMember.findFirst({
                            where: { campaignId, userId: uid },
                            include: { campaign: { select: { gmId: true } } },
                        });
                        if (memberRecord) {
                            connectedUsers.push({
                                id: uid,
                                username: s.data['username'],
                                avatarUrl: s.data['avatarUrl'],
                                role: memberRecord.campaign.gmId === uid ? 'GM' : 'PLAYER',
                            });
                        }
                    }
                }
                socket.emit('session:roomState', { users: connectedUsers });
                // Scene items and fog are stored per-user in the browser — live sync only.
                socket.emit('fog:sync', { sessionId, fogData: '[]' });
                socket.emit('items:sync', { sessionId, items: [] });
            }
            catch (err) {
                console.error('[Socket] session:join error:', err);
                socket.emit('error', { message: 'Failed to join session' });
            }
        });
        socket.on('session:leave', ({ sessionId }) => {
            socket.leave(sessionId);
            socket.to(sessionId).emit('session:userLeft', { sessionId, userId });
        });
        // ── Generic scene items (unified editor) — relay only; clients persist locally ──
        socket.on('item:add', (payload) => {
            socket.to(payload.sessionId).emit('item:add', payload);
        });
        socket.on('item:update', (payload) => {
            socket.to(payload.sessionId).emit('item:update', payload);
        });
        socket.on('item:remove', (payload) => {
            socket.to(payload.sessionId).emit('item:remove', payload);
        });
        socket.on('items:sync', (payload) => {
            socket.to(payload.sessionId).emit('items:sync', payload);
        });
        // ── Map ──────────────────────────────────────────────────────────────────
        socket.on('map:tokenMove', (payload) => {
            socket.to(payload.sessionId).emit('map:tokenMove', payload);
        });
        socket.on('map:fogUpdate', (payload) => {
            socket.to(payload.sessionId).emit('map:fogUpdate', payload);
        });
        socket.on('fog:sync', (payload) => {
            socket.to(payload.sessionId).emit('fog:sync', payload);
        });
        socket.on('map:gridUpdate', (payload) => {
            socket.to(payload.sessionId).emit('map:gridUpdate', payload);
        });
        socket.on('map:mapMove', (payload) => {
            socket.to(payload.sessionId).emit('map:mapMove', payload);
        });
        socket.on('map:mapResize', (payload) => {
            socket.to(payload.sessionId).emit('map:mapResize', payload);
        });
        socket.on('map:mapLock', (payload) => {
            socket.to(payload.sessionId).emit('map:mapLock', payload);
        });
        socket.on('map:mapHide', (payload) => {
            socket.to(payload.sessionId).emit('map:mapHide', payload);
        });
        socket.on('map:mapDelete', (payload) => {
            socket.to(payload.sessionId).emit('map:mapDelete', payload);
        });
        socket.on('map:gridStyle', (payload) => {
            socket.to(payload.sessionId).emit('map:gridStyle', payload);
        });
        socket.on('map:gridOffset', (payload) => {
            socket.to(payload.sessionId).emit('map:gridOffset', payload);
        });
        socket.on('map:tokenConditions', (payload) => {
            socket.to(payload.sessionId).emit('map:tokenConditions', payload);
        });
        socket.on('map:tokenAura', (payload) => {
            socket.to(payload.sessionId).emit('map:tokenAura', payload);
        });
        // ── Drawing ──────────────────────────────────────────────────────────────
        socket.on('drawing:add', (payload) => {
            socket.to(payload.sessionId).emit('drawing:add', payload);
        });
        socket.on('drawing:remove', (payload) => {
            socket.to(payload.sessionId).emit('drawing:remove', payload);
        });
        socket.on('drawing:clear', (payload) => {
            socket.to(payload.sessionId).emit('drawing:clear', payload);
        });
        // ── Initiative sync ──────────────────────────────────────────────────────
        socket.on('initiative:sync', (payload) => {
            io.to(payload.sessionId).emit('initiative:sync', payload);
        });
        // ── Combat ───────────────────────────────────────────────────────────────
        socket.on('combat:initiative', (payload) => {
            io.to(payload.sessionId).emit('combat:initiative', payload);
        });
        socket.on('combat:hpUpdate', (payload) => {
            io.to(payload.sessionId).emit('combat:hpUpdate', payload);
        });
        // ── Dice ─────────────────────────────────────────────────────────────────
        socket.on('dice:roll', async (payload) => {
            if (payload.isSecret) {
                const room = io.sockets.adapter.rooms.get(payload.sessionId);
                if (room) {
                    for (const socketId of room) {
                        const s = io.sockets.sockets.get(socketId);
                        if (s?.data['role'] === 'GM')
                            s.emit('dice:roll', payload);
                    }
                }
            }
            else {
                io.to(payload.sessionId).emit('dice:roll', payload);
            }
            try {
                await prisma.sessionLog.create({
                    data: {
                        sessionId: payload.sessionId,
                        userId: payload.rollerId || undefined,
                        type: 'DICE_ROLL',
                        // Prisma Json field requires casting through unknown
                        data: payload,
                    },
                });
            }
            catch {
                // Non-critical — log silently
            }
        });
        // ── Scene ────────────────────────────────────────────────────────────────
        socket.on('scene:change', (payload) => {
            io.to(payload.sessionId).emit('scene:change', payload);
        });
        // ── Handout ──────────────────────────────────────────────────────────────
        socket.on('handout:reveal', (payload) => {
            if (payload.targetUserIds === 'all') {
                io.to(payload.sessionId).emit('handout:reveal', payload);
            }
            else {
                const room = io.sockets.adapter.rooms.get(payload.sessionId);
                const targets = payload.targetUserIds;
                if (room) {
                    for (const socketId of room) {
                        const s = io.sockets.sockets.get(socketId);
                        if (s && targets.includes(s.data['userId'])) {
                            s.emit('handout:reveal', payload);
                        }
                    }
                }
            }
        });
        // ── Chat ─────────────────────────────────────────────────────────────────
        socket.on('chat:message', async (payload) => {
            if (payload.whisperToId) {
                const room = io.sockets.adapter.rooms.get(payload.sessionId);
                if (room) {
                    for (const socketId of room) {
                        const s = io.sockets.sockets.get(socketId);
                        if (s &&
                            (s.data['userId'] === payload.whisperToId ||
                                s.data['userId'] === payload.senderId)) {
                            s.emit('chat:message', payload);
                        }
                    }
                }
            }
            else {
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
                        rollData: payload.roll ? payload.roll : undefined,
                        whisperToId: payload.whisperToId ?? null,
                        timestamp: new Date(payload.timestamp),
                    },
                });
            }
            catch {
                // Non-critical
            }
        });
        // ── Disconnect ───────────────────────────────────────────────────────────
        socket.on('disconnect', () => {
            const sessionId = socket.data['sessionId'];
            if (sessionId) {
                socket.to(sessionId).emit('session:userLeft', { sessionId, userId });
            }
            console.log(`[Socket] User ${username} disconnected`);
        });
    });
    setCompendiumSocketServer(io);
    return io;
}
//# sourceMappingURL=index.js.map