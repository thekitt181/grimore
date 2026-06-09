/** Test roll bridge poll emits new DDB rolls. Roll on DDB during the 30s window. */
import 'dotenv/config';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const conn = await prisma.ddbConnection.findFirst();
  if (!conn) throw new Error('No DDB connection');
  const session = await prisma.gameSession.findFirst({
    where: { isActive: true, campaign: { ddbCampaignLink: { isNot: null } } },
    include: { campaign: { include: { ddbCampaignLink: true } } },
    orderBy: { startedAt: 'desc' },
  });
  await prisma.$disconnect();
  if (!session) throw new Error('No active session with DDB link');

  const sessionId = session.id;
  const ddbCampaignId = session.campaign.ddbCampaignLink?.ddbCampaignId ?? 6133312;

  const { initSocket } = await import('../src/socket/index.ts');
  const { startRollBridge, stopRollBridge } = await import('../src/services/ddb/ddbRollBridge.ts');
  const httpServer = createServer();
  const io = initSocket(httpServer);

  const received: unknown[] = [];
  io.on('connection', (socket) => {
    socket.join(sessionId);
    socket.on('ddb:roll', (payload) => {
      received.push(payload);
      console.log('ROLL:', payload.characterName, payload.label, '->', payload.total);
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  console.log('Bridge test session:', sessionId);
  await startRollBridge(io, sessionId, conn.userId, ddbCampaignId);
  console.log(`Roll on DDB campaign ${ddbCampaignId} NOW...`);

  await new Promise((r) => setTimeout(r, 30_000));
  stopRollBridge(sessionId);
  httpServer.close();
  console.log(`Received ${received.length} new roll(s)`);
  process.exit(received.length > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
