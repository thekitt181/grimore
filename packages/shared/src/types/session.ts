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
