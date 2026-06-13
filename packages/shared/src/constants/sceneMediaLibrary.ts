import type { LightingPreset, SceneTransition, TimeOfDay, WeatherOverlay } from '../types/scene';

/** Curated royalty-free ambient audio + video loops (Mixkit CDN). */

export type MediaLibraryCategory =
  | 'tavern'
  | 'dungeon'
  | 'forest'
  | 'cave'
  | 'combat'
  | 'ocean'
  | 'temple'
  | 'city'
  | 'swamp'
  | 'winter'
  | 'fire'
  | 'wind'
  | 'horror'
  | 'camp'
  | 'library';

export interface MediaLibraryEntry {
  id: string;
  name: string;
  category: MediaLibraryCategory;
  url: string;
  loop: boolean;
  defaultVolume: number;
  tags: string[];
}

export interface VideoLibraryEntry {
  id: string;
  name: string;
  category: MediaLibraryCategory;
  url: string;
  loop: boolean;
  tags: string[];
}

/** Ambient loops — add your own via Upload or scene ambient URL. */
export const AMBIENT_SOUND_LIBRARY: MediaLibraryEntry[] = [];

/** Music tracks — add your own via Upload or scene media config. */
export const MUSIC_LIBRARY: MediaLibraryEntry[] = [];

/** Looping background videos for scene pop-ups / overlays. */
export const VIDEO_LIBRARY: VideoLibraryEntry[] = [
  { id: 'vid-fireplace', name: 'Fireplace', category: 'tavern', url: 'https://assets.mixkit.co/videos/preview/mixkit-fireplace-burning-4267-large.mp4', loop: true, tags: ['warm', 'indoor'] },
  { id: 'vid-rain-window', name: 'Rain on Window', category: 'city', url: 'https://assets.mixkit.co/videos/preview/mixkit-rain-falling-on-the-water-1536-large.mp4', loop: true, tags: ['rain', 'mood'] },
  { id: 'vid-fog-forest', name: 'Foggy Forest', category: 'forest', url: 'https://assets.mixkit.co/videos/preview/mixkit-fog-in-the-forest-1243-large.mp4', loop: true, tags: ['fog', 'nature'] },
  { id: 'vid-storm-sea', name: 'Stormy Sea', category: 'ocean', url: 'https://assets.mixkit.co/videos/preview/mixkit-waves-in-the-water-1164-large.mp4', loop: true, tags: ['storm', 'ocean'] },
  { id: 'vid-torch-dungeon', name: 'Torch Flicker', category: 'dungeon', url: 'https://assets.mixkit.co/videos/preview/mixkit-flames-burning-in-the-dark-4268-large.mp4', loop: true, tags: ['fire', 'dark'] },
  { id: 'vid-snow', name: 'Falling Snow', category: 'winter', url: 'https://assets.mixkit.co/videos/preview/mixkit-snowfall-in-a-pine-forest-4290-large.mp4', loop: true, tags: ['snow', 'cold'] },
];

export const LIGHTING_PRESETS: Array<{ id: LightingPreset; label: string; description: string }> = [
  { id: 'default', label: 'Default', description: 'Neutral tabletop lighting' },
  { id: 'torchlight', label: 'Torchlight', description: 'Warm flickering orange glow' },
  { id: 'moonlight', label: 'Moonlight', description: 'Cool blue night tones' },
  { id: 'overcast', label: 'Overcast', description: 'Flat grey daylight' },
  { id: 'underdark', label: 'Underdark', description: 'Deep purple darkness' },
  { id: 'ethereal', label: 'Ethereal', description: 'Soft magical cyan haze' },
  { id: 'blood-moon', label: 'Blood Moon', description: 'Ominous crimson tint' },
];

export const TIME_OF_DAY_PRESETS: Array<{ id: TimeOfDay; label: string }> = [
  { id: 'dawn', label: 'Dawn' },
  { id: 'day', label: 'Midday' },
  { id: 'golden-hour', label: 'Golden Hour' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' },
  { id: 'midnight', label: 'Midnight' },
];

export const WEATHER_PRESETS: Array<{ id: WeatherOverlay; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'rain', label: 'Rain' },
  { id: 'heavy-rain', label: 'Heavy Rain' },
  { id: 'hail', label: 'Hail' },
  { id: 'storm', label: 'Storm' },
  { id: 'snow', label: 'Snow' },
  { id: 'blizzard', label: 'Blizzard' },
  { id: 'fog', label: 'Fog' },
  { id: 'mist', label: 'Mist' },
  { id: 'sandstorm', label: 'Sandstorm' },
  { id: 'swamp', label: 'Swamp Mist' },
  { id: 'ash', label: 'Ash Fall' },
  { id: 'embers', label: 'Embers' },
  { id: 'leaves', label: 'Autumn Leaves' },
  { id: 'fireflies', label: 'Fireflies' },
  { id: 'aurora', label: 'Aurora' },
];

export const SCENE_TRANSITIONS: Array<{ id: SceneTransition; label: string }> = [
  { id: 'fade', label: 'Fade' },
  { id: 'page-turn', label: 'Page Turn' },
  { id: 'fire', label: 'Fire Wipe' },
  { id: 'none', label: 'Instant' },
];
