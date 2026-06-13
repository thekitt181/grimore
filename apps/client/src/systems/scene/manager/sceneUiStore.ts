import { create } from 'zustand';

interface SceneUiState {
  sceneManagerOpen: boolean;
  setSceneManagerOpen: (open: boolean) => void;
}

export const useSceneUiStore = create<SceneUiState>((set) => ({
  sceneManagerOpen: false,
  setSceneManagerOpen: (sceneManagerOpen) => set({ sceneManagerOpen }),
}));
