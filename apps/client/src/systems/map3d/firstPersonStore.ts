import { create } from 'zustand';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { clearWalkPose } from '@/systems/scene/token/walkPoseBus';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { resetFirstPersonLook } from './firstPersonLook';
import { clearFirstPersonPose } from './firstPersonPose';
import { resetFirstPersonMotion } from './firstPersonMotion';
import { fpGlobal } from './fpGlobals';

/** Default walk speed when initiative is on (D&D 5e Medium). */
export const DEFAULT_WALK_SPEED_FT = 30;

export type FpToolMode = 'none' | 'spray' | 'breach' | 'erase';
/** How spray / breach strokes are shaped while held. */
export type FpDrawShape = 'freehand' | 'circle';

interface FirstPersonState {
  /** Player (or GM) looking through a token in 3D. */
  enabled: boolean;
  /** Token used for the current FP session (cleared on exit). */
  tokenId: string | null;
  /** Feet moved on the current initiative turn for each token. */
  feetUsedByToken: Record<string, number>;
  /** Turn key last synced — round:index — so a new turn clears the budget. */
  turnKey: string;
  /** FP interaction tool (spray paint / GM wall breach). */
  tool: FpToolMode;
  /** Freehand stroke vs circle stamp/cut. */
  drawShape: FpDrawShape;
  /** Brush width in world px for spray + breach window. */
  brushSize: number;

  setEnabled: (enabled: boolean, opts?: { seedYawDeg?: number; tokenId?: string | null }) => void;
  setTool: (tool: FpToolMode) => void;
  setDrawShape: (drawShape: FpDrawShape) => void;
  setBrushSize: (brushSize: number) => void;
  syncTurn: (turnKey: string) => void;
  addFeetUsed: (tokenId: string, feet: number) => void;
  feetUsed: (tokenId: string) => number;
  remainingFeet: (tokenId: string, speedFt?: number) => number;
}

export const useFirstPersonStore = create<FirstPersonState>((set, get) => ({
  enabled: false,
  tokenId: null,
  feetUsedByToken: {},
  turnKey: '',
  tool: 'none',
  drawShape: 'circle',
  brushSize: 16,

  setEnabled: (enabled, opts) => {
    if (enabled) {
      resetFirstPersonLook(opts?.seedYawDeg ?? 0);
      set({ enabled: true, tokenId: opts?.tokenId ?? null });
      return;
    }
    const prevId = get().tokenId;
    // Dynamic import avoids circular init with fpPoseSync.
    void import('./fpPoseSync').then(({ stopFpPosePublisher }) => {
      stopFpPosePublisher();
    });
    if (prevId) {
      clearWalkPose(prevId);
      useLiveTransformStore.getState().clear([prevId]);
    }
    fpGlobal.walkStreaming = false;
    clearFirstPersonPose();
    resetFirstPersonMotion();
    resetFirstPersonLook(0);
    set({ enabled: false, tokenId: null, tool: 'none' });
    // Leaving FP always drops selection so the token isn't left grab-ready.
    useItemStore.getState().clearSelection();
    // Keep undo history for the session so re-entering FP can still undo.
  },
  setTool: (tool) => set({ tool }),
  setDrawShape: (drawShape) => set({ drawShape }),
  setBrushSize: (brushSize) => set({ brushSize: Math.max(2, Math.min(64, brushSize)) }),
  syncTurn: (turnKey) => {
    if (get().turnKey === turnKey) return;
    set({ turnKey, feetUsedByToken: {} });
  },
  addFeetUsed: (tokenId, feet) => {
    if (feet <= 0) return;
    set((s) => ({
      feetUsedByToken: {
        ...s.feetUsedByToken,
        [tokenId]: (s.feetUsedByToken[tokenId] ?? 0) + feet,
      },
    }));
  },
  feetUsed: (tokenId) => get().feetUsedByToken[tokenId] ?? 0,
  remainingFeet: (tokenId, speedFt = DEFAULT_WALK_SPEED_FT) =>
    Math.max(0, speedFt - (get().feetUsedByToken[tokenId] ?? 0)),
}));
