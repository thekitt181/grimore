import type { Request, Response, NextFunction } from 'express';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { prisma } from '../lib/prisma';

const clerk = createClerkClient({
  secretKey: process.env['CLERK_SECRET_KEY'] ?? '',
});

export interface AuthenticatedRequest extends Request {
  userId?: string;
  clerkUserId?: string;
}

/**
 * Verifies the Clerk session token from the Authorization header
 * and attaches the database userId to the request.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);

    const payload = await verifyToken(token, {
      secretKey: process.env['CLERK_SECRET_KEY'] ?? '',
    });

    const clerkUserId = payload.sub;
    if (!clerkUserId) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    // Find or create the user in our database
    let user = await prisma.user.findUnique({ where: { clerkId: clerkUserId } });

    if (!user) {
      const clerkUser = await clerk.users.getUser(clerkUserId);
      user = await prisma.user.create({
        data: {
          clerkId: clerkUserId,
          username:
            clerkUser.username ??
            clerkUser.firstName ??
            clerkUser.emailAddresses[0]?.emailAddress.split('@')[0] ??
            'Adventurer',
          avatarUrl: clerkUser.imageUrl ?? null,
        },
      });
    }

    req.userId = user.id;
    req.clerkUserId = clerkUserId;
    next();
  } catch (err) {
    console.error('[Auth] Token verification failed:', err);
    res.status(401).json({ error: 'Unauthorized' });
  }
}
