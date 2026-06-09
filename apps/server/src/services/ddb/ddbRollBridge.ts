import WebSocket from 'ws';
import type { Server } from 'socket.io';
import type { DdbRollBridgePayload } from '@grimoire/shared';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import {
  cobaltCacheId,
  getBearerToken,
  invalidateBearer,
  normalizeCobaltToken,
} from './cobaltAuth';
import { userIdFromBearer } from './campaigns';
import { getCobaltForUser } from './ddbService';

const WS_BASE = 'wss://game-log-api-live.dndbeyond.com/v1';
const REST_BASE = 'https://game-log-rest-live.dndbeyond.com/v1';
const RECONNECT_MS = 5000;
const POLL_MS = 2500;
const PING_MS = 5000;
const MAX_SEEN_IDS = 500;

interface ActiveBridge {
  ws: WebSocket;
  sessionId: string;
  userId: string;
  ddbCampaignId: number;
  ddbUserId: number;
  bearer: string;
  cobalt: string;
  seenIds: Set<string>;
  pollSeeded: boolean;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  pollTimer?: ReturnType<typeof setInterval>;
  pingTimer?: ReturnType<typeof setInterval>;
}

const bridges = new Map<string, ActiveBridge>();
let debugMessageCount = 0;

interface ParsedDdbRoll {
  characterName: string;
  ddbCharacterId?: number;
  label: string;
  notation: string;
  total: number;
  diceResults: number[];
  isDamage: boolean;
}

function parseRollMessage(data: unknown): ParsedDdbRoll | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  const eventType = String(msg.eventType ?? msg.type ?? '');
  if (!eventType.includes('dice/roll') && !eventType.includes('roll/fulfilled')) {
    return null;
  }

  const envelope = (msg.data ?? msg.payload) as Record<string, unknown> | undefined;
  if (!envelope) return null;

  const rolls = envelope.rolls as unknown[] | undefined;
  if (!Array.isArray(rolls) || rolls.length === 0) return null;

  const roll = rolls[0] as Record<string, unknown>;
  const context = (envelope.context ?? roll.context ?? {}) as Record<string, unknown>;
  const result = (roll.result ?? envelope.result ?? {}) as Record<string, unknown>;
  const diceNotation = (roll.diceNotation ?? envelope.diceNotation ?? {}) as Record<string, unknown>;

  const characterName = String(context.name ?? context.entityName ?? 'Character');
  const entityId = context.entityId ?? msg.entityId;
  const parsedEntityId =
    typeof entityId === 'number' ? entityId : parseInt(String(entityId ?? ''), 10);

  const label = String(
    envelope.action ?? roll.action ?? roll.rollType ?? roll.label ?? 'Roll',
  );
  const total = Number(result.total ?? roll.total ?? envelope.total ?? 0);

  let notation = String(result.text ?? diceNotation.notation ?? roll.notation ?? '');
  const diceResults: number[] = [];
  const values = result.values as unknown[] | undefined;
  if (Array.isArray(values)) {
    for (const v of values) {
      const n = Number(v);
      if (Number.isFinite(n)) diceResults.push(n);
    }
  }
  const sets = (diceNotation.set ?? roll.sets ?? []) as unknown[];
  for (const set of sets) {
    if (!set || typeof set !== 'object') continue;
    const dice = (set as Record<string, unknown>).dice as unknown[] | undefined;
    if (!Array.isArray(dice)) continue;
    for (const die of dice) {
      if (!die || typeof die !== 'object') continue;
      const val = Number((die as Record<string, unknown>).dieValue);
      if (Number.isFinite(val)) diceResults.push(val);
    }
  }

  if (!notation && diceResults.length) {
    notation = diceResults.join(' + ');
  }
  if (!notation && total) notation = String(total);

  const lower = `${label} ${notation}`.toLowerCase();
  const isDamage = /damage|dmg|hit|attack/.test(lower);

  if (!Number.isFinite(total) && diceResults.length === 0) return null;

  return {
    characterName,
    ddbCharacterId: Number.isFinite(parsedEntityId) ? parsedEntityId : undefined,
    label,
    notation,
    total: Number.isFinite(total) ? total : diceResults.reduce((a, b) => a + b, 0),
    diceResults,
    isDamage,
  };
}

function buildWsUrl(gameId: number, ddbUserId: number, bearer: string): string {
  return `${WS_BASE}?gameId=${gameId}&userId=${ddbUserId}&stt=${bearer}`;
}

function toPayload(
  sessionId: string,
  parsed: ParsedDdbRoll,
  messageId?: string,
): DdbRollBridgePayload {
  return {
    sessionId,
    characterName: parsed.characterName,
    ddbCharacterId: parsed.ddbCharacterId,
    label: parsed.label,
    notation: parsed.notation,
    total: parsed.total,
    isDamage: parsed.isDamage,
    diceResults: parsed.diceResults,
    ...(messageId ? { messageId } : {}),
  };
}

function emitRollPayload(io: Server, payload: DdbRollBridgePayload): void {
  io.to(payload.sessionId).emit('ddb:roll', payload);
  console.log(
    `[DDB] roll bridge: ${payload.characterName} ${payload.label} → ${payload.total} (session=${payload.sessionId})`,
  );
}

async function markRollSeenInRedis(sessionId: string, messageId: string): Promise<void> {
  const seenKey = `ddb:roll-seen:${sessionId}`;
  await redis.sadd(seenKey, messageId);
  await redis.expire(seenKey, SEEN_TTL);
}

/** Broadcast DDB rolls to every client in the session (HTTP poll + bridge). */
export function broadcastDdbRolls(io: Server, sessionId: string, rolls: DdbRollBridgePayload[]): void {
  for (const payload of rolls) {
    emitRollPayload(io, payload);
  }
}

function emitRoll(io: Server, sessionId: string, parsed: ParsedDdbRoll, messageId?: string): void {
  emitRollPayload(io, toPayload(sessionId, parsed, messageId));
}

function handleGameLogMessage(io: Server, bridge: ActiveBridge, data: unknown): void {
  const msg = data as Record<string, unknown> | undefined;
  const msgId = typeof msg?.id === 'string' ? msg.id : null;

  if (msgId) {
    if (bridge.seenIds.has(msgId)) return;
    bridge.seenIds.add(msgId);
    if (bridge.seenIds.size > MAX_SEEN_IDS) {
      const drop = bridge.seenIds.values().next().value;
      if (drop) bridge.seenIds.delete(drop);
    }
  }

  const parsed = parseRollMessage(data);
  if (!parsed) {
    if (debugMessageCount < 8 && msg && typeof msg === 'object') {
      const eventType = msg.eventType;
      if (eventType) {
        debugMessageCount += 1;
        console.log(`[DDB] roll bridge message: ${String(eventType)}`);
      }
    }
    return;
  }

  debugMessageCount = 0;
  if (msgId) void markRollSeenInRedis(bridge.sessionId, msgId);
  emitRoll(io, bridge.sessionId, parsed, msgId ?? undefined);
}

async function pollGameLog(io: Server, bridge: ActiveBridge): Promise<void> {
  try {
    const rolls = await fetchNewDdbRollsForSession(bridge.sessionId);
    bridge.pollSeeded = true;
    for (const payload of rolls) {
      emitRollPayload(io, payload);
    }
  } catch (err) {
    console.warn('[DDB] roll bridge poll error:', err instanceof Error ? err.message : err);
  }
}

/** Obtain bearer token with User.ID cookie (required for game-log REST/WS). */
async function getGameLogAuth(cobalt: string): Promise<{ bearer: string; ddbUserId: number } | null> {
  const token = normalizeCobaltToken(cobalt);
  const cacheId = cobaltCacheId(token);

  let bearer = await getBearerToken(cacheId, token);
  if (!bearer) return null;

  let ddbUserId = userIdFromBearer(bearer);
  if (!ddbUserId) {
    console.warn('[DDB] roll bridge: could not parse DDB user id from bearer JWT');
    return null;
  }

  // Game-log APIs expect token obtained with User.ID cookie (AstralBridge / EncounterLog pattern).
  await invalidateBearer(cacheId);
  bearer = await getBearerToken(cacheId, token, ddbUserId);
  if (!bearer) return null;

  ddbUserId = userIdFromBearer(bearer) ?? ddbUserId;
  return { bearer, ddbUserId };
}

function scheduleReconnect(io: Server, bridge: ActiveBridge): void {
  const { sessionId, userId, ddbCampaignId } = bridge;
  stopRollBridge(sessionId);
  setTimeout(() => {
    void startRollBridge(io, sessionId, userId, ddbCampaignId);
  }, RECONNECT_MS);
}

function clearBridgeTimers(bridge: ActiveBridge): void {
  if (bridge.reconnectTimer) clearTimeout(bridge.reconnectTimer);
  if (bridge.pollTimer) clearInterval(bridge.pollTimer);
  if (bridge.pingTimer) clearInterval(bridge.pingTimer);
}

async function connectBridge(
  io: Server,
  sessionId: string,
  userId: string,
  ddbCampaignId: number,
): Promise<void> {
  const cobalt = await getCobaltForUser(userId);
  if (!cobalt) {
    console.warn('[DDB] roll bridge: no cobalt token');
    return;
  }

  const token = normalizeCobaltToken(cobalt);
  const auth = await getGameLogAuth(token);
  if (!auth) {
    console.warn('[DDB] roll bridge: no bearer token');
    return;
  }

  const { bearer, ddbUserId } = auth;
  console.log(`[DDB] roll bridge connecting userId=${ddbUserId} campaign=${ddbCampaignId}`);

  const ws = new WebSocket(buildWsUrl(ddbCampaignId, ddbUserId, bearer), {
    headers: {
      Origin: 'https://www.dndbeyond.com',
      Cookie: `CobaltSession=${token}; User.ID=${ddbUserId}`,
    },
  });

  const bridge: ActiveBridge = {
    ws,
    sessionId,
    userId,
    ddbCampaignId,
    ddbUserId,
    bearer,
    cobalt: token,
    seenIds: new Set(),
    pollSeeded: false,
  };
  bridges.set(sessionId, bridge);

  ws.on('open', () => {
    console.log(`[DDB] roll bridge connected (session=${sessionId}, campaign=${ddbCampaignId})`);
  });

  ws.on('message', (raw) => {
    try {
      handleGameLogMessage(io, bridge, JSON.parse(raw.toString()) as unknown);
    } catch {
      // ignore malformed frames
    }
  });

  ws.on('close', (code) => {
    console.warn(`[DDB] roll bridge WS closed (${code}) session=${sessionId}`);
    const current = bridges.get(sessionId);
    if (!current || current.ws !== ws) return;
    // Keep REST poll running; WS will reconnect.
    current.reconnectTimer = setTimeout(() => {
      void reconnectWs(io, sessionId);
    }, RECONNECT_MS);
  });

  ws.on('error', (err) => {
    console.warn('[DDB] roll bridge WS error:', err instanceof Error ? err.message : err);
  });

  bridge.pingTimer = setInterval(() => {
    if (bridge.ws.readyState === WebSocket.OPEN) bridge.ws.ping();
  }, PING_MS);

  bridge.pollTimer = setInterval(() => {
    void pollGameLog(io, bridge);
  }, POLL_MS);

  // Seed + first poll immediately.
  void pollGameLog(io, bridge);
}

async function reconnectWs(io: Server, sessionId: string): Promise<void> {
  const bridge = bridges.get(sessionId);
  if (!bridge) return;

  try {
    const auth = await getGameLogAuth(bridge.cobalt);
    if (!auth) return;

    bridge.bearer = auth.bearer;
    bridge.ddbUserId = auth.ddbUserId;

    const ws = new WebSocket(buildWsUrl(bridge.ddbCampaignId, bridge.ddbUserId, bridge.bearer), {
      headers: {
        Origin: 'https://www.dndbeyond.com',
        Cookie: `CobaltSession=${bridge.cobalt}; User.ID=${bridge.ddbUserId}`,
      },
    });
    bridge.ws = ws;

    ws.on('open', () => {
      console.log(`[DDB] roll bridge WS reconnected (session=${sessionId})`);
    });
    ws.on('message', (raw) => {
      try {
        handleGameLogMessage(io, bridge, JSON.parse(raw.toString()) as unknown);
      } catch { /* ignore */ }
    });
    ws.on('close', (code) => {
      console.warn(`[DDB] roll bridge WS closed (${code}) session=${sessionId}`);
      if (bridges.get(sessionId)?.ws === ws) {
        bridge.reconnectTimer = setTimeout(() => {
          void reconnectWs(io, sessionId);
        }, RECONNECT_MS);
      }
    });
    ws.on('error', () => { /* logged on close */ });
  } catch {
    bridge.reconnectTimer = setTimeout(() => {
      void reconnectWs(io, sessionId);
    }, RECONNECT_MS);
  }
}

export async function startRollBridge(
  io: Server,
  sessionId: string,
  userId: string,
  ddbCampaignId?: number,
): Promise<void> {
  const conn = await prisma.ddbConnection.findUnique({ where: { userId } });
  if (!conn) {
    console.warn('[DDB] roll bridge: user has no D&D Beyond connection');
    return;
  }
  if (!conn.rollBridgeEnabled) {
    console.warn('[DDB] roll bridge: disabled — enable in Account link settings');
    return;
  }

  if (!ddbCampaignId) {
    console.warn(
      '[DDB] roll bridge: link your Grimoire campaign to a D&D Beyond campaign first',
    );
    return;
  }

  const existing = bridges.get(sessionId);
  if (
    existing &&
    existing.userId === userId &&
    existing.ddbCampaignId === ddbCampaignId &&
    existing.pollTimer
  ) {
    console.log(`[DDB] roll bridge already active (session=${sessionId}, campaign=${ddbCampaignId})`);
    return;
  }

  stopRollBridge(sessionId);
  debugMessageCount = 0;
  await connectBridge(io, sessionId, userId, ddbCampaignId);
}

export function isRollBridgeActive(sessionId: string): boolean {
  const bridge = bridges.get(sessionId);
  return Boolean(bridge?.pollTimer);
}

export function getRollBridgeDebug(sessionId: string): {
  active: boolean;
  pollSeeded: boolean;
  seenCount: number;
  ddbCampaignId?: number;
  ddbUserId?: number;
} | null {
  const bridge = bridges.get(sessionId);
  if (!bridge) return { active: false, pollSeeded: false, seenCount: 0 };
  return {
    active: Boolean(bridge.pollTimer),
    pollSeeded: bridge.pollSeeded,
    seenCount: bridge.seenIds.size,
    ddbCampaignId: bridge.ddbCampaignId,
    ddbUserId: bridge.ddbUserId,
  };
}

export function stopRollBridge(sessionId: string, userId?: string): void {
  const existing = bridges.get(sessionId);
  if (!existing) return;
  if (userId && existing.userId !== userId) return;

  clearBridgeTimers(existing);
  try {
    existing.ws.close();
  } catch { /* ignore */ }
  bridges.delete(sessionId);
}

/** Resolve which Grimoire user should own the DDB roll bridge for a campaign. */
export async function resolveRollBridgeUserId(campaignId: string): Promise<string | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { gmId: true },
  });
  if (!campaign) return null;

  const gmConn = await prisma.ddbConnection.findUnique({ where: { userId: campaign.gmId } });
  if (gmConn?.rollBridgeEnabled) return campaign.gmId;

  return null;
}

const SEEN_TTL = 60 * 60 * 24;

/** Poll DDB game log for new rolls (Redis-backed dedup). Used by bridge + HTTP API. */
export async function fetchNewDdbRollsForSession(sessionId: string): Promise<DdbRollBridgePayload[]> {
  const gameSession = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: { campaign: { include: { ddbCampaignLink: true } } },
  });
  if (!gameSession?.campaign.ddbCampaignLink) return [];

  const bridgeUserId = await resolveRollBridgeUserId(gameSession.campaignId);
  if (!bridgeUserId) return [];

  const conn = await prisma.ddbConnection.findUnique({ where: { userId: bridgeUserId } });
  if (!conn?.rollBridgeEnabled) return [];

  const cobalt = await getCobaltForUser(bridgeUserId);
  if (!cobalt) return [];

  const auth = await getGameLogAuth(normalizeCobaltToken(cobalt));
  if (!auth) return [];

  const ddbCampaignId = gameSession.campaign.ddbCampaignLink.ddbCampaignId;
  const url = `${REST_BASE}/getmessages?gameId=${ddbCampaignId}&userId=${auth.ddbUserId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${auth.bearer}`,
      Accept: 'application/json',
      Origin: 'https://www.dndbeyond.com',
    },
  });
  if (!res.ok) return [];

  const json = (await res.json()) as { data?: unknown[]; messages?: unknown[] };
  const msgs = json.data ?? json.messages ?? [];
  if (!Array.isArray(msgs)) return [];

  const seenKey = `ddb:roll-seen:${sessionId}`;
  const initKey = `ddb:roll-seeded:${sessionId}`;
  const seeded = await redis.get(initKey);

  if (!seeded) {
    for (const msg of msgs) {
      const id = (msg as Record<string, unknown>).id;
      if (typeof id === 'string') await redis.sadd(seenKey, id);
    }
    await redis.setex(initKey, SEEN_TTL, '1');
    await redis.expire(seenKey, SEEN_TTL);
    console.log(`[DDB] roll poll seeded session=${sessionId} (${msgs.length} messages)`);
    return [];
  }

  const out: DdbRollBridgePayload[] = [];
  for (const msg of msgs) {
    const id = (msg as Record<string, unknown>).id;
    if (typeof id !== 'string') continue;
    const isNew = await redis.sadd(seenKey, id);
    if (isNew === 0) continue;

    const parsed = parseRollMessage(msg);
    if (!parsed) continue;

    console.log(
      `[DDB] roll poll: ${parsed.characterName} ${parsed.label} → ${parsed.total} (session=${sessionId})`,
    );
    out.push(toPayload(sessionId, parsed, id));
  }

  return out;
}
