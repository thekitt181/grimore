export type GridTypeApi = 'SQUARE' | 'HEX';
export type SceneTransition = 'fade' | 'fire' | 'page-turn' | 'none';
export type LightingPreset =
  | 'default'
  | 'torchlight'
  | 'moonlight'
  | 'overcast'
  | 'underdark'
  | 'ethereal'
  | 'blood-moon';
export type WeatherOverlay =
  | 'none'
  | 'rain'
  | 'heavy-rain'
  | 'snow'
  | 'fog'
  | 'storm'
  | 'embers'
  | 'leaves';

export interface SceneAudioLayer {
  id: string;
  name: string;
  url: string;
  volume: number;
  loop: boolean;
  /** Built-in library entry id when applicable. */
  libraryId?: string;
  category?: string;
}

export interface SceneMusicTrack {
  id: string;
  name: string;
  url: string;
  volume: number;
  libraryId?: string;
}

export interface SceneVideoPopup {
  url: string;
  loop: boolean;
  muted: boolean;
  autoplay: boolean;
  /** Full-screen overlay vs corner popup card. */
  showAsOverlay: boolean;
}

export interface SceneMediaConfig {
  ambientLayers: SceneAudioLayer[];
  musicPlaylist: SceneMusicTrack[];
  musicMode: 'single' | 'playlist' | 'crossfade';
  masterVolume: number;
  videoPopup?: SceneVideoPopup | null;
}

export const DEFAULT_SCENE_MEDIA_CONFIG: SceneMediaConfig = {
  ambientLayers: [],
  musicPlaylist: [],
  musicMode: 'crossfade',
  masterVolume: 0.85,
  videoPopup: null,
};

export interface GameMapRecord {
  id: string;
  campaignId: string;
  name: string;
  imageUrl: string;
  gridType: GridTypeApi;
  gridSize: number;
  scale: string;
  width: number;
  height: number;
  tags: string[];
  walls: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface SceneRecord {
  id: string;
  campaignId: string;
  name: string;
  mapId: string | null;
  ambientAudioUrl: string | null;
  backgroundVideoUrl: string | null;
  lightingPreset: LightingPreset;
  weatherOverlay: WeatherOverlay | null;
  mediaConfig: SceneMediaConfig;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  map?: GameMapRecord | null;
}

export interface SceneBundle {
  scene: SceneRecord;
  transition: SceneTransition;
}

export interface CreateScenePayload {
  name: string;
  mapId?: string | null;
  ambientAudioUrl?: string | null;
  backgroundVideoUrl?: string | null;
  lightingPreset?: LightingPreset;
  weatherOverlay?: WeatherOverlay | null;
  mediaConfig?: Partial<SceneMediaConfig>;
}

export interface UpdateScenePayload extends Partial<CreateScenePayload> {
  sortOrder?: number;
}

export interface CreateGameMapPayload {
  name: string;
  imageUrl: string;
  gridType?: GridTypeApi;
  gridSize?: number;
  scale?: string;
  width?: number;
  height?: number;
  tags?: string[];
  walls?: unknown;
}
