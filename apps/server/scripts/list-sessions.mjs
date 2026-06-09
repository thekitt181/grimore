import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const sessions = await prisma.gameSession.findMany({
    where: { isActive: true },
    include: { campaign: { include: { ddbCampaignLink: true } } },
    orderBy: { startedAt: 'desc' },
    take: 5,
  });
  console.log(JSON.stringify(sessions, null, 2));
} finally {
  await prisma.$disconnect();
}
