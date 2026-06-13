import { create } from 'zustand';
import { emitTokenType, emitTokenRotate } from '../token/tokenSync';
import { useItemStore } from './itemStore';
import type { TokenItem } from '../types';

interface TokenStoreState {
  setTokenRenderType: (tokenId: string, renderType: '2d' | '3d') => void;
  rotateToken: (tokenId: string, deltaDeg: number) => void;
}

export const useTokenStore = create<TokenStoreState>(() => ({
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
