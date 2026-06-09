/** Monitor active roll bridge + detect new DDB rolls for 45s. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const session = await prisma.gameSession.findFirst({
    where: { isActive: true, campaign: { ddbCampaignLink: { isNot: null } } },
    include: { campaign: { include: { ddbCampaignLink: true } } },
    orderBy: { startedAt: 'desc' },
  });
  const conn = await prisma.ddbConnection.findFirst();
  await prisma.$disconnect();

  if (!session || !conn) {
    console.log('No session or DDB conn');
    process.exit(1);
  }

  const { getRollBridgeDebug, startRollBridge, stopRollBridge } = await import(
    '../src/services/ddb/ddbRollBridge.ts'
  );
  const { initSocket } = await import('../src/socket/index.ts');
  const { createServer } = await import('http');

  const sessionId = session.id;
  const ddbCampaignId = session.campaign.ddbCampaignLink!.ddbCampaignId;
  const httpServer = createServer();
  const io = initSocket(httpServer);
  await new Promise<void>((r) => httpServer.listen(0, r));

  let clientReceived = 0;
  io.on('connection', (s) => {
    s.join(sessionId);
    console.log('Mock client joined room', sessionId, 'socket', s.id);
    s.on('ddb:roll', (p) => {
      clientReceived++;
      console.log('CLIENT GOT ROLL:', p.characterName, p.label, p.total);
    });
  });

  console.log('Starting bridge for session', sessionId, 'ddb', ddbCampaignId);
  await startRollBridge(io, sessionId, conn.userId, ddbCampaignId);
  console.log('Bridge debug:', getRollBridgeDebug(sessionId));

  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const dbg = getRollBridgeDebug(sessionId);
    console.log(`[${i + 1}] active=${dbg?.active} seeded=${dbg?.pollSeeded} seen=${dbg?.seenCount} clientRolls=${clientReceived}`);
  }

  stopRollBridge(sessionId);
  httpServer.close();
  console.log('Total client rolls:', clientReceived);
  process.exit(clientReceived > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
