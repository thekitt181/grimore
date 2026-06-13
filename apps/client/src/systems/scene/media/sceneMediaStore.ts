import { create } from 'zustand';
import type {
  LightingPreset,
  SceneMediaConfig,
  SceneRecord,
  SceneTransition,
  WeatherOverlay,
  WeatherSettings,
} from '@grimoire/shared';
import { DEFAULT_SCENE_MEDIA_CONFIG } from '@grimoire/shared';

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  cover: 65,
  wind: 40,
  direction: 200,
};

interface SceneMediaState {
  activeScene: SceneRecord | null;
  /** Live weather when no scene is active (map context menu). */
  sessionWeather: WeatherOverlay | null;
  sessionWeatherSettings: WeatherSettings;
  cinemaTakeover: boolean;
  transition: SceneTransition;
  transitioning: boolean;
  masterVolume: number;
  ambientMuted: boolean;
  musicMuted: boolean;
  /** GM-only local preview before pushing to session. */
  previewMode: boolean;
  setActiveScene: (scene: SceneRecord | null, transition?: SceneTransition) => void;
  setWeatherOverlay: (weather: WeatherOverlay | null) => void;
  setWeatherSettings: (settings: Partial<WeatherSettings>) => void;
  setCinemaTakeover: (active: boolean) => void;
  clearVideoPlayback: () => void;
  setTransitioning: (v: boolean) => void;
  setMasterVolume: (v: number) => void;
  setAmbientMuted: (v: boolean) => void;
  setMusicMuted: (v: boolean) => void;
  setPreviewMode: (v: boolean) => void;
  patchMediaConfig: (patch: Partial<SceneMediaConfig>) => void;
}

export const useSceneMediaStore = create<SceneMediaState>((set, get) => ({
  activeScene: null,
  sessionWeather: null,
  sessionWeatherSettings: DEFAULT_WEATHER_SETTINGS,
  cinemaTakeover: false,
  transition: 'fade',
  transitioning: false,
  masterVolume: DEFAULT_SCENE_MEDIA_CONFIG.masterVolume,
  ambientMuted: false,
  musicMuted: false,
  previewMode: false,
  setActiveScene: (scene, transition = 'fade') =>
    set({ activeScene: scene, transition, transitioning: true }),
  setWeatherOverlay: (weather) => {
    const scene = get().activeScene;
    if (scene) {
      set({ activeScene: { ...scene, weatherOverlay: weather } });
    } else {
      set({ sessionWeather: weather });
    }
  },
  setWeatherSettings: (patch) =>
    set((s) => ({
      sessionWeatherSettings: { ...s.sessionWeatherSettings, ...patch },
    })),
  setCinemaTakeover: (cinemaTakeover) => set({ cinemaTakeover }),
  clearVideoPlayback: () => {
    const scene = get().activeScene;
    if (!scene) {
      set({ cinemaTakeover: false });
      return;
    }
    set({
      cinemaTakeover: false,
      activeScene: {
        ...scene,
        backgroundVideoUrl: null,
        mediaConfig: { ...scene.mediaConfig, videoPopup: null },
      },
    });
  },
  setTransitioning: (transitioning) => set({ transitioning }),
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setAmbientMuted: (ambientMuted) => set({ ambientMuted }),
  setMusicMuted: (musicMuted) => set({ musicMuted }),
  setPreviewMode: (previewMode) => set({ previewMode }),
  patchMediaConfig: (patch) => {
    const scene = get().activeScene;
    if (!scene) return;
    set({
      activeScene: {
        ...scene,
        mediaConfig: { ...scene.mediaConfig, ...patch },
      },
    });
  },
}));

export function getActiveLighting(): LightingPreset {
  return useSceneMediaStore.getState().activeScene?.lightingPreset ?? 'default';
}

export function getActiveWeather(): WeatherOverlay | null {
  const { activeScene, sessionWeather } = useSceneMediaStore.getState();
  const w = activeScene?.weatherOverlay ?? sessionWeather;
  return w && w !== 'none' ? w : null;
}
