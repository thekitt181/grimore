import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import {
  buildSessionRecap,
  cleanRecapUtterance,
  EMPTY_SESSION_RECAP,
  type RecapLine,
  type SessionRecapDoc,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@grimoire/shared';

type RecapSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RecapServer = Server<ClientToServerEvents, ServerToClientEvents>;

const MAX_LINES = 500;
const transcripts = new Map<string, RecapLine[]>();
const recaps = new Map<string, SessionRecapDoc>();

function rebuild(sessionId: string, published?: boolean): SessionRecapDoc {
  const prev = recaps.get(sessionId);
  const doc = buildSessionRecap(transcripts.get(sessionId) ?? [], {
    published: published ?? prev?.published ?? false,
  });
  recaps.set(sessionId, doc);
  return doc;
}

const syncWait = new Map<string, ReturnType<typeof setTimeout>>();

function emitSync(io: RecapServer, sessionId: string): void {
  const recap = recaps.get(sessionId) ?? rebuild(sessionId);
  const lines = transcripts.get(sessionId) ?? [];
  io.to(sessionId).emit('recap:sync', { sessionId, recap, lines });
}

function scheduleSync(io: RecapServer, sessionId: string): void {
  if (syncWait.has(sessionId)) return;
  const t = setTimeout(() => {
    syncWait.delete(sessionId);
    emitSync(io, sessionId);
  }, 1200);
  syncWait.set(sessionId, t);
}

export function bindSessionRecapHandlers(io: RecapServer, socket: RecapSocket): void {
  socket.on('voice:transcript', ({ sessionId, text }) => {
    if (socket.data['sessionId'] !== sessionId) return;
    const cleaned = cleanRecapUtterance(text ?? '');
    if (!cleaned) return;
    const line: RecapLine = {
      id: randomUUID(),
      userId: (socket.data['userId'] as string) || '',
      username: (socket.data['username'] as string) || 'Player',
      text: cleaned,
      at: Date.now(),
    };
    const list = transcripts.get(sessionId) ?? [];
    list.push(line);
    if (list.length > MAX_LINES) list.splice(0, list.length - MAX_LINES);
    transcripts.set(sessionId, list);
    rebuild(sessionId);
    io.to(sessionId).emit('voice:transcript', { sessionId, line });
    scheduleSync(io, sessionId);
  });

  socket.on('recap:request', ({ sessionId }) => {
    if (socket.data['sessionId'] !== sessionId) return;
    const recap = recaps.get(sessionId) ?? EMPTY_SESSION_RECAP;
    const lines = transcripts.get(sessionId) ?? [];
    socket.emit('recap:sync', { sessionId, recap, lines });
  });

  socket.on('recap:publish', ({ sessionId, published }) => {
    if (socket.data['sessionId'] !== sessionId) return;
    if (socket.data['role'] !== 'GM') return;
    const recap = rebuild(sessionId, Boolean(published));
    recaps.set(sessionId, recap);
    emitSync(io, sessionId);
  });

  socket.on('recap:clear', ({ sessionId }) => {
    if (socket.data['sessionId'] !== sessionId) return;
    if (socket.data['role'] !== 'GM') return;
    transcripts.delete(sessionId);
    recaps.set(sessionId, { ...EMPTY_SESSION_RECAP, updatedAt: Date.now() });
    emitSync(io, sessionId);
  });
}
