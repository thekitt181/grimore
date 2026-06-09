import 'dotenv/config';
import { createDecipheriv, createHash } from 'crypto';

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

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const conn = await prisma.ddbConnection.findFirst();
const cobalt = decryptToken(conn.cobaltEncrypted);
await prisma.$disconnect();

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
const bearer2 = (await r2.json()).token;

const res = await fetch(
  `https://game-log-rest-live.dndbeyond.com/v1/getmessages?gameId=6133312&userId=${uid}`,
  { headers: { Authorization: `Bearer ${bearer2}`, Accept: 'application/json' } },
);
const json = await res.json();
console.log('keys:', Object.keys(json));
const msgs = Array.isArray(json) ? json : json.messages ?? json.data ?? [];
console.log('count:', msgs.length, 'sample keys:', msgs[0] ? Object.keys(msgs[0]) : []);
const roll = msgs.find((m) => m.eventType === 'dice/roll/fulfilled') ?? msgs[0];
console.log('eventType:', roll?.eventType);
console.log(JSON.stringify(roll, null, 2));
