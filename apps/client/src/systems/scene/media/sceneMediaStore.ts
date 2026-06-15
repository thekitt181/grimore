import { create } from 'zustand';
import type {
  GameTime,
  LightingPreset,
  SceneMediaConfig,
  SceneRecord,
  SceneTransition,
  TimeOfDay,
  WeatherOverlay,
  WeatherSettings,
} from '@grimoire/shared';
import { DEFAULT_GAME_TIME, DEFAULT_SCENE_MEDIA_CONFIG, gameTimeToTimeOfDay, normalizeGameTime, TIME_OF_DAY_TO_GAME_TIME } from '@grimoire/shared';

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  cover: 65,
  wind: 40,
  direction: 200,
};

export type ActiveWeatherOverlay = Exclude<WeatherOverlay, 'none'>;

export function normalizeWeatherOverlay(
  weather: WeatherOverlay | null | undefined,
): ActiveWeatherOverlay | null {
  if (!weather || weather === 'none') return null;
  return weather;
}

/** Active weather for rendering — null means clear (never fall back when scene explicitly has none). */
export function selectEffectiveWeather(state: {
  activeScene: SceneRecord | null;
  sessionWeather: WeatherOverlay | null;
}): ActiveWeatherOverlay | null {
  if (state.activeScene != null) {
    return normalizeWeatherOverlay(state.activeScene.weatherOverlay);
  }
  return normalizeWeatherOverlay(state.sessionWeather);
}

interface SceneMediaState {
  activeScene: SceneRecord | null;
  /** Live weather when no scene is active (map context menu). */
  sessionWeather: WeatherOverlay | null;
  sessionTimeOfDay: TimeOfDay | null;
  sessionGameTime: GameTime | null;
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
  setTimeOfDay: (time: TimeOfDay | null) => void;
  setGameTime: (time: GameTime | null) => void;
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
  sessionTimeOfDay: null,
  sessionGameTime: null,
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
    const normalized = normalizeWeatherOverlay(weather);
    set((s) => {
      if (s.activeScene) {
        return {
          sessionWeather: normalized,
          activeScene: { ...s.activeScene, weatherOverlay: normalized },
        };
      }
      return { sessionWeather: normalized };
    });
  },
  setTimeOfDay: (time) => {
    const scene = get().activeScene;
    if (scene) {
      set({ activeScene: { ...scene, timeOfDay: time } });
    } else {
      set({ sessionTimeOfDay: time });
    }
  },
  setGameTime: (time) => {
    const scene = get().activeScene;
    if (scene) {
      set({ activeScene: { ...scene, gameTime: time } });
    } else {
      set({ sessionGameTime: time });
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

export function getActiveWeather(): ActiveWeatherOverlay | null {
  return selectEffectiveWeather(useSceneMediaStore.getState());
}

export function getActiveTimeOfDay(): TimeOfDay {
  const { activeScene, sessionTimeOfDay, sessionGameTime } = useSceneMediaStore.getState();
  const gt = activeScene?.gameTime ?? sessionGameTime;
  if (gt) return gameTimeToTimeOfDay(normalizeGameTime(gt));
  if (activeScene?.timeOfDay) return activeScene.timeOfDay;
  if (sessionTimeOfDay) return sessionTimeOfDay;
  return 'day';
}

export function getActiveGameTime(): GameTime {
  const { activeScene, sessionGameTime } = useSceneMediaStore.getState();
  const gt = activeScene?.gameTime ?? sessionGameTime;
  if (gt) return normalizeGameTime(gt);
  if (activeScene?.timeOfDay) return TIME_OF_DAY_TO_GAME_TIME[activeScene.timeOfDay];
  return DEFAULT_GAME_TIME;
}
