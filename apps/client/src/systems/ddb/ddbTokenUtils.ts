import { isMobileClient } from '@/lib/socket';
import type { TokenItem } from '@/systems/scene/types';

export function isDdbPcToken(token: TokenItem): boolean {
  return Boolean(token.isPc || token.ddbCharacterId);
}

export function ddbPanelWidth(desktopWidth: number): number {
  if (!isMobileClient() || typeof window === 'undefined') return desktopWidth;
  return Math.min(desktopWidth, Math.max(300, window.innerWidth - 20));
}

export function ddbPanelPosition(desktopX: number, y: number): { x: number; y: number } {
  if (!isMobileClient()) return { x: desktopX, y };
  return { x: 10, y };
}
