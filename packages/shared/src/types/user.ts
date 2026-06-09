export type UserRole = 'GM' | 'PLAYER';

export interface UserProfile {
  id: string;
  clerkId: string;
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
