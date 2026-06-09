import 'dotenv/config';
import { createDecipheriv, createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

function decrypt(blob) {
  const key = createHash('sha256')
    .update(process.env.DDB_TOKEN_ENCRYPTION_KEY ?? 'dev-only-change-me-32chars!!')
    .digest();
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

const prisma = new PrismaClient();
const conn = await prisma.ddbConnection.findFirst();
const cobalt = decrypt(conn.cobaltEncrypted);
const res = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: `CobaltSession=${cobalt}` },
  body: '{}',
});
const { token } = await res.json();
const payload = JSON.parse(
  Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
);
console.log(JSON.stringify(payload, null, 2));

const urls = [
  'https://www.dndbeyond.com/api/user',
  'https://www.dndbeyond.com/api/auth/user',
  'https://www.dndbeyond.com/api/user/info',
];
for (const url of urls) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: `CobaltSession=${cobalt}`,
      Accept: 'application/json',
    },
  });
  console.log(url, r.status, (await r.text()).slice(0, 200));
}

await prisma.$disconnect();
