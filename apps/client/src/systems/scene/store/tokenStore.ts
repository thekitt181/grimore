import { create } from 'zustand';
import { emitTokenMove, emitTokenType, emitTokenRotate } from '../token/tokenSync';
import { tokenBoundsFromGrid } from '../token/tokenGrid';
import { useItemStore } from './itemStore';
import type { TokenItem } from '../types';

interface TokenStoreState {
  moveModeTokenId: string | null;
  setMoveMode: (tokenId: string | null) => void;
  toggleMoveMode: (tokenId: string) => void;
  moveTokenToGrid: (tokenId: string, gridCol: number, gridRow: number) => void;
  setTokenRenderType: (tokenId: string, renderType: '2d' | '3d') => void;
  rotateToken: (tokenId: string, deltaDeg: number) => void;
}

export const useTokenStore = create<TokenStoreState>((set, get) => ({
  moveModeTokenId: null,

  setMoveMode: (tokenId) => set({ moveModeTokenId: tokenId }),

  toggleMoveMode: (tokenId) => {
    const cur = get().moveModeTokenId;
    set({ moveModeTokenId: cur === tokenId ? null : tokenId });
  },

  moveTokenToGrid: (tokenId, gridCol, gridRow) => {
    const token = useItemStore.getState().items[tokenId] as TokenItem | undefined;
    if (!token || token.type !== 'token') return;
    const bounds = tokenBoundsFromGrid(token, gridCol, gridRow);
    emitTokenMove(tokenId, gridCol, gridRow, bounds.x, bounds.y);
  },

  setTokenRenderType: (tokenId, renderType) => {
    emitTokenType(tokenId, renderType);
  },

  rotateToken: (tokenId, deltaDeg) => {
    const token = useItemStore.getState().items[tokenId] as TokenItem | undefined;
    if (!token || token.type !== 'token') return;
    const rotation = ((token.rotation + deltaDeg) % 360 + 360) % 360;
    emitTokenRotate(tokenId, rotation);
  },
}));
