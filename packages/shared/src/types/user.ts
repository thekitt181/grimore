export type UserRole = 'GM' | 'PLAYER';

export interface UserProfile {
  id: string;
  authUserId: string;
  username: string;
  avatarUrl?: string;
  createdAt: Date;
}

export interface SessionUser {
  id: string;
  username: string;
  avatarUrl?: string;
  role: UserRole;
}
