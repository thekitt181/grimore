/**
 * Test D&D Beyond game-log WebSocket (requires linked account in DB or COBALT env).
 * Usage: node scripts/test-roll-bridge.mjs [campaignId]
 */
import 'dotenv/config';
import WebSocket from 'ws';
import { createDecipheriv, createHash } from 'crypto';

const CAMPAIGN_ID = parseInt(process.argv[2] ?? '6133312', 10);

function decryptToken(blob) {
  const key = createHash('sha256')
    .update(process.env.DDB_TOKEN_ENCRYPTION_KEY ?? 'dev-only-change-me-32chars!!')
    .digest();
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

async function getCobaltFromDb() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const conn = await prisma.ddbConnection.findFirst();
    if (!conn) throw new Error('No DdbConnection row — link account in Grimoire first');
    return decryptToken(conn.cobaltEncrypted);
  } finally {
    await prisma.$disconnect();
  }
}

async function getBearer(cobalt) {
  const res = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `CobaltSession=${cobalt}` },
    body: '{}',
  });
  const json = await res.json();
  if (!json.token) throw new Error(`Auth failed: ${res.status}`);
  return json.token;
}

function userIdFromBearer(bearer) {
  try {
    const json = JSON.parse(
      Buffer.from(bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    const candidates = [
      json.userId,
      json.UserId,
      json.sub,
      json.id,
      json['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'],
    ];
    for (const c of candidates) {
      const n = typeof c === 'string' ? parseInt(c, 10) : typeof c === 'number' ? c : NaN;
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch { /* ignore */ }
  return null;
}

async function tryRestGameId(cobalt, bearer, campaignId) {
  const headers = {
    Authorization: `Bearer ${bearer}`,
    Cookie: `CobaltSession=${cobalt}`,
    Accept: 'application/json',
    Origin: 'https://www.dndbeyond.com',
  };
  const urls = [
    `https://game-log-rest-live.dndbeyond.com/v1/campaign/${campaignId}/game`,
    `https://game-log-rest-live.dndbeyond.com/v1/campaign/${campaignId}`,
    `https://www.dndbeyond.com/api/campaign/${campaignId}/game-log`,
    `https://www.dndbeyond.com/api/campaign/stt/game/${campaignId}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      console.log(`REST ${res.status} ${url}`);
      if (text.length < 500) console.log(' ', text);
      else console.log(' ', text.slice(0, 300), '...');
    } catch (e) {
      console.log(`REST ERR ${url}`, e.message);
    }
  }
}

function connectWs(gameId, userId, bearer, cobalt) {
  const url = `wss://game-log-api-live.dndbeyond.com/v1?gameId=${gameId}&userId=${userId}&stt=${encodeURIComponent(bearer)}`;
  console.log(`\nWS connect gameId=${gameId} userId=${userId}`);
  const ws = new WebSocket(url, {
    headers: { Origin: 'https://www.dndbeyond.com', Cookie: `CobaltSession=${cobalt}` },
  });
  ws.on('open', () => console.log('WS open — roll on DDB now'));
  ws.on('message', (raw) => {
    const text = raw.toString();
    try {
      const json = JSON.parse(text);
      console.log('MSG', json.eventType ?? json.type ?? Object.keys(json).slice(0, 5));
      if (json.eventType?.includes('roll') || json.eventType?.includes('dice')) {
        console.log(JSON.stringify(json, null, 2).slice(0, 1500));
      }
    } catch {
      console.log('RAW', text.slice(0, 200));
    }
  });
  ws.on('close', (code) => console.log('WS close', code));
  ws.on('error', (e) => console.log('WS error', e.message));
  setTimeout(() => { ws.close(); process.exit(0); }, 120_000);
}

const cobalt = process.env.COBALT?.trim() || (await getCobaltFromDb());
const bearer = await getBearer(cobalt);
const userId = userIdFromBearer(bearer);
console.log('userId from bearer:', userId);
await tryRestGameId(cobalt, bearer, CAMPAIGN_ID);
connectWs(CAMPAIGN_ID, userId, bearer, cobalt);
