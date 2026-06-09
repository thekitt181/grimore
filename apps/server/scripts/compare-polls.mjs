/** Compare getmessages over two polls — run, roll on DDB, run again. */
import 'dotenv/config';
import { createDecipheriv, createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

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

async function auth(cobalt) {
  const r1 = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', {
    method: 'POST',
    headers: { Cookie: `CobaltSession=${cobalt}` },
    body: '{}',
  });
  const bearer = (await r1.json()).token;
  const uid = JSON.parse(
    Buffer.from(bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
  )['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'];
  const r2 = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', {
    method: 'POST',
    headers: { Cookie: `CobaltSession=${cobalt}; User.ID=${uid}` },
    body: '{}',
  });
  return { bearer: (await r2.json()).token, uid };
}

async function fetchMsgs(bearer, gameId, uid, lastKey) {
  let url = `https://game-log-rest-live.dndbeyond.com/v1/getmessages?gameId=${gameId}&userId=${uid}`;
  if (lastKey) url += `&lastKey=${encodeURIComponent(lastKey)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
  });
  const json = await res.json();
  return { status: res.status, json };
}

const prisma = new PrismaClient();
const conn = await prisma.ddbConnection.findFirst();
const cobalt = decryptToken(conn.cobaltEncrypted);
await prisma.$disconnect();

const { bearer, uid } = await auth(cobalt);
const gameId = 6133312;

const a = await fetchMsgs(bearer, gameId, uid);
const msgsA = a.json.data ?? [];
const lastKey = a.json.lastKey;
console.log('Poll A:', msgsA.length, 'msgs, lastKey:', lastKey);
console.log('Latest id:', msgsA.at(-1)?.id, msgsA.at(-1)?.data?.action);

await new Promise((r) => setTimeout(r, 8000));
console.log('(Roll on DDB now if testing live)');

const b = await fetchMsgs(bearer, gameId, uid);
const msgsB = b.json.data ?? [];
console.log('Poll B:', msgsB.length, 'msgs, lastKey:', b.json.lastKey);

const idsA = new Set(msgsA.map((m) => m.id));
const newOnes = msgsB.filter((m) => !idsA.has(m.id));
console.log('New since A:', newOnes.length);
for (const m of newOnes) {
  console.log(' NEW', m.eventType, m.data?.context?.name, m.data?.action, m.data?.rolls?.[0]?.result?.total);
}

// Test lastKey incremental fetch
if (lastKey) {
  const c = await fetchMsgs(bearer, gameId, uid, lastKey);
  const msgsC = c.json.data ?? [];
  console.log('Poll C (with lastKey):', msgsC.length, 'msgs');
}
