import { create } from 'zustand';
import { useMapStore } from '@/systems/map/store/mapStore';
import { emitTokenType, emitTokenRotate } from '../token/tokenSync';
import { useItemStore } from './itemStore';
import type { TokenItem } from '../types';

interface TokenStoreState {
  setTokenRenderType: (tokenId: string, renderType: '2d' | '3d') => void;
  rotateToken: (tokenId: string, deltaDeg: number) => void;
  /** Facing → 0°; GLB minis also reset orbit / 3D view angle. */
  resetTokenRotation: (tokenId: string) => void;
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

  resetTokenRotation: (tokenId) => {
    const token = useItemStore.getState().items[tokenId] as TokenItem | undefined;
    if (!token || token.type !== 'token') return;
    emitTokenRotate(tokenId, 0);
    if (token.modelUrl) {
      useMapStore.getState().resetTokenViewAngle(tokenId);
    }
  },
}));
