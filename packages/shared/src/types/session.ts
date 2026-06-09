import type { SessionUser } from './user';

export interface GameSession {
  id: string;
  campaignId: string;
  activeSceneId?: string;
  isActive: boolean;
  startedAt: Date;
}

export interface SessionRoom {
  sessionId: string;
  campaignId: string;
  connectedUsers: SessionUser[];
  gmUserId: string;
}

/** One entry per user id (last wins) — safe when multiple tabs/sockets share a room. */
export function dedupeSessionUsers(users: SessionUser[]): SessionUser[] {
  const byId = new Map<string, SessionUser>();
  for (const user of users) byId.set(user.id, user);
  return [...byId.values()];
}
