/**
 * Deep probe of D&D Beyond game-log API (WS + REST).
 * Usage: node scripts/probe-ddb-gamelog.mjs [campaignId]
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
    if (!conn) throw new Error('No DdbConnection');
    return decryptToken(conn.cobaltEncrypted);
  } finally {
    await prisma.$disconnect();
  }
}

function userIdFromBearer(bearer) {
  try {
    const json = JSON.parse(
      Buffer.from(bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    for (const c of [
      json.userId,
      json.UserId,
      json.sub,
      json.id,
      json['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'],
    ]) {
      const n = typeof c === 'string' ? parseInt(c, 10) : typeof c === 'number' ? c : NaN;
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchBearer(cobalt, ddbUserId) {
  const cookies = [`CobaltSession=${cobalt}`];
  if (ddbUserId) cookies.push(`User.ID=${ddbUserId}`);
  const res = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
    body: '{}',
  });
  const json = await res.json();
  if (!json.token) throw new Error(`Auth ${res.status}: ${JSON.stringify(json)}`);
  return json.token;
}

async function probeRest(bearer, gameId, userId) {
  const headers = {
    Authorization: `Bearer ${bearer}`,
    Accept: 'application/json',
    Origin: 'https://www.dndbeyond.com',
  };
  const urls = [
    `https://game-log-rest-live.dndbeyond.com/v1/getmessages?gameId=${gameId}&userId=${userId}`,
    `https://game-log-rest-live.dndbeyond.com/v1/getmessages?gameId=${gameId}`,
  ];
  for (const url of urls) {
    const res = await fetch(url, { headers });
    const text = await res.text();
    console.log(`\nREST ${res.status} ${url}`);
    if (res.ok) {
      try {
        const json = JSON.parse(text);
        const msgs = json.messages ?? json.data ?? json;
        const arr = Array.isArray(msgs) ? msgs : [];
        console.log(`  messages: ${arr.length}`);
        const rolls = arr.filter((m) => String(m.eventType ?? '').includes('roll'));
        console.log(`  roll events: ${rolls.length}`);
        if (rolls.length) {
          console.log('  latest roll:', JSON.stringify(rolls[rolls.length - 1], null, 2).slice(0, 800));
        }
      } catch {
        console.log(' ', text.slice(0, 400));
      }
    } else {
      console.log(' ', text.slice(0, 400));
    }
  }
}

function connectWs(gameId, userId, bearer, cobalt) {
  const url = `wss://game-log-api-live.dndbeyond.com/v1?gameId=${gameId}&userId=${userId}&stt=${bearer}`;
  console.log(`\nWS connect gameId=${gameId} userId=${userId}`);
  const ws = new WebSocket(url, {
    headers: { Origin: 'https://www.dndbeyond.com', Cookie: `CobaltSession=${cobalt}; User.ID=${userId}` },
  });

  let msgCount = 0;
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 5000);

  ws.on('open', () => console.log('WS open — roll on DDB character in this campaign NOW'));
  ws.on('message', (raw) => {
    msgCount += 1;
    const text = raw.toString();
    try {
      const json = JSON.parse(text);
      const et = json.eventType ?? json.type ?? '(no type)';
      console.log(`MSG #${msgCount}: ${et}`);
      if (String(et).includes('roll') || String(et).includes('dice')) {
        console.log(JSON.stringify(json, null, 2).slice(0, 2000));
      }
    } catch {
      console.log(`RAW #${msgCount}:`, text.slice(0, 200));
    }
  });
  ws.on('close', (code) => {
    clearInterval(pingTimer);
    console.log(`WS close ${code}, total messages: ${msgCount}`);
    process.exit(0);
  });
  ws.on('error', (e) => console.log('WS error', e.message));

  setTimeout(() => {
    clearInterval(pingTimer);
    console.log(`\nTimeout after 180s — total WS messages: ${msgCount}`);
    if (msgCount === 0) {
      console.log('No messages received. Check: character in campaign 6133312, roll on dndbeyond.com, Cobalt token fresh.');
    }
    ws.close();
    process.exit(0);
  }, 180_000);
}

const cobalt = process.env.COBALT?.trim() || (await getCobaltFromDb());
let bearer = await fetchBearer(cobalt);
let userId = userIdFromBearer(bearer);
console.log('userId (pass 1):', userId);

if (userId) {
  bearer = await fetchBearer(cobalt, userId);
  userId = userIdFromBearer(bearer) ?? userId;
  console.log('userId (pass 2 with User.ID cookie):', userId);
}

await probeRest(bearer, CAMPAIGN_ID, userId);
connectWs(CAMPAIGN_ID, userId, bearer, cobalt);
