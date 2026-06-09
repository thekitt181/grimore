/** Monitor roll bridge for 45s — roll on DDB while this runs. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createServer } from 'http';

async function main() {
  const prisma = new PrismaClient();
  const session = await prisma.gameSession.findFirst({
    where: { isActive: true, campaign: { ddbCampaignLink: { isNot: null } } },
    include: { campaign: { include: { ddbCampaignLink: true } } },
    orderBy: { startedAt: 'desc' },
  });
  const conn = await prisma.ddbConnection.findFirst();
  await prisma.$disconnect();
  if (!session || !conn) throw new Error('Need session + DDB link');

  const { initSocket } = await import('../src/socket/index.ts');
  const { startRollBridge, stopRollBridge, getRollBridgeDebug } = await import(
    '../src/services/ddb/ddbRollBridge.ts'
  );

  const sessionId = session.id;
  const ddbCampaignId = session.campaign.ddbCampaignLink!.ddbCampaignId;
  const httpServer = createServer();
  const io = initSocket(httpServer);
  await new Promise<void>((r) => httpServer.listen(0, r));

  let clientReceived = 0;
  io.on('connection', (s) => {
    s.join(sessionId);
    s.on('ddb:roll', (p) => {
      clientReceived++;
      console.log('ROLL RX:', p.characterName, p.label, p.total);
    });
  });

  console.log('sessionId:', sessionId, 'ddbCampaign:', ddbCampaignId);
  await startRollBridge(io, sessionId, conn.userId, ddbCampaignId);

  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const d = getRollBridgeDebug(sessionId);
    console.log(`tick ${i + 1}: active=${d?.active} seen=${d?.seenCount} rx=${clientReceived}`);
  }

  stopRollBridge(sessionId);
  httpServer.close();
  process.exit(clientReceived > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
