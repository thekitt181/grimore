import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const conn = await prisma.ddbConnection.findFirst({ include: { user: true } });
  const links = await prisma.ddbCampaignLink.findMany();
  console.log(JSON.stringify({ conn, links }, null, 2));
} finally {
  await prisma.$disconnect();
}
