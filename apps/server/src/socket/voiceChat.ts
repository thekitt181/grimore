import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  VoiceIceServer,
  VoicePeerInfo,
} from '@grimoire/shared';

type VoiceSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type VoiceServer = Server<ClientToServerEvents, ServerToClientEvents>;

const MAX_VOICE_PEERS = 12;
const voiceBySession = new Map<string, Map<string, VoicePeerInfo>>();

function iceServers(): VoiceIceServer[] {
  const stun: VoiceIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const turnUrls = (process.env['VOICE_TURN_URLS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (turnUrls.length === 0) return stun;
  const username = process.env['VOICE_TURN_USERNAME']?.trim();
  const credential = process.env['VOICE_TURN_CREDENTIAL']?.trim();
  const turn: VoiceIceServer = { urls: turnUrls };
  if (username && credential) {
    turn.username = username;
    turn.credential = credential;
  }
  return [...stun, turn];
}

function room(sessionId: string): Map<string, VoicePeerInfo> {
  let map = voiceBySession.get(sessionId);
  if (!map) {
    map = new Map();
    voiceBySession.set(sessionId, map);
  }
  return map;
}

export function dropSocketFromVoice(io: VoiceServer, socket: VoiceSocket): void {
  const sessionId = socket.data['sessionId'] as string | undefined;
  if (!sessionId) return;
  leaveVoice(io, socket, sessionId);
}

function leaveVoice(io: VoiceServer, socket: VoiceSocket, sessionId: string): void {
  const map = voiceBySession.get(sessionId);
  const peer = map?.get(socket.id);
  if (!map?.delete(socket.id)) return;
  if (map.size === 0) voiceBySession.delete(sessionId);
  if (peer?.userId) {
    io.to(sessionId).emit('voice:speaking', {
      sessionId,
      userId: peer.userId,
      speaking: false,
    });
  }
  io.to(sessionId).emit('voice:peer-left', { sessionId, socketId: socket.id });
}

export function bindVoiceSocketHandlers(io: VoiceServer, socket: VoiceSocket): void {
  socket.on('voice:join', ({ sessionId }) => {
    if (socket.data['sessionId'] !== sessionId) return;
    const map = room(sessionId);
    if (!map.has(socket.id) && map.size >= MAX_VOICE_PEERS) {
      socket.emit('error', { message: 'Voice channel is full' });
      return;
    }
    const peer: VoicePeerInfo = {
      socketId: socket.id,
      userId: socket.data['userId'] as string,
      username: (socket.data['username'] as string) || 'Player',
      muted: map.get(socket.id)?.muted ?? false,
    };
    const others = [...map.values()].filter((p) => p.socketId !== socket.id);
    map.set(socket.id, peer);
    socket.emit('voice:peers', {
      sessionId,
      selfSocketId: socket.id,
      peers: others,
      iceServers: iceServers(),
    });
    socket.to(sessionId).emit('voice:peer-joined', { sessionId, peer });
  });

  socket.on('voice:leave', ({ sessionId }) => {
    if (socket.data['sessionId'] !== sessionId) return;
    leaveVoice(io, socket, sessionId);
  });

  socket.on('voice:signal', (payload) => {
    if (socket.data['sessionId'] !== payload.sessionId) return;
    const map = voiceBySession.get(payload.sessionId);
    if (!map?.has(socket.id) || !map.has(payload.toSocketId)) return;
    io.to(payload.toSocketId).emit('voice:signal', {
      sessionId: payload.sessionId,
      toSocketId: payload.toSocketId,
      fromSocketId: socket.id,
      data: payload.data,
    });
  });

  socket.on('voice:mute', ({ sessionId, muted }) => {
    if (socket.data['sessionId'] !== sessionId) return;
    const map = voiceBySession.get(sessionId);
    const peer = map?.get(socket.id);
    if (!peer) return;
    peer.muted = Boolean(muted);
    io.to(sessionId).emit('voice:mute', {
      sessionId,
      socketId: socket.id,
      muted: peer.muted,
    });
    if (peer.muted) {
      io.to(sessionId).emit('voice:speaking', {
        sessionId,
        userId: peer.userId,
        speaking: false,
      });
    }
  });

  socket.on('voice:speaking', ({ sessionId, speaking }) => {
    if (socket.data['sessionId'] !== sessionId) return;
    const map = voiceBySession.get(sessionId);
    if (!map?.has(socket.id)) return;
    const userId = socket.data['userId'] as string | undefined;
    if (!userId) return;
    io.to(sessionId).emit('voice:speaking', {
      sessionId,
      userId,
      speaking: Boolean(speaking),
    });
  });
}
