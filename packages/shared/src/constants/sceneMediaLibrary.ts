import type { LightingPreset, SceneTransition, WeatherOverlay } from '../types/scene';

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

/** Ambient loops — stack multiple layers for rich soundscapes. */
export const AMBIENT_SOUND_LIBRARY: MediaLibraryEntry[] = [
  { id: 'tavern-crowd', name: 'Tavern Crowd', category: 'tavern', url: 'https://assets.mixkit.co/active_storage/sfx/2570/2570-preview.mp3', loop: true, defaultVolume: 0.55, tags: ['social', 'indoor'] },
  { id: 'tavern-fire', name: 'Crackling Hearth', category: 'tavern', url: 'https://assets.mixkit.co/active_storage/sfx/2468/2468-preview.mp3', loop: true, defaultVolume: 0.45, tags: ['fire', 'warm'] },
  { id: 'dungeon-drips', name: 'Dungeon Drips', category: 'dungeon', url: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3', loop: true, defaultVolume: 0.5, tags: ['water', 'cave'] },
  { id: 'dungeon-wind', name: 'Deep Wind', category: 'dungeon', url: 'https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3', loop: true, defaultVolume: 0.4, tags: ['wind', 'eerie'] },
  { id: 'forest-birds', name: 'Forest Birds', category: 'forest', url: 'https://assets.mixkit.co/active_storage/sfx/2432/2432-preview.mp3', loop: true, defaultVolume: 0.5, tags: ['nature', 'day'] },
  { id: 'forest-stream', name: 'Forest Stream', category: 'forest', url: 'https://assets.mixkit.co/active_storage/sfx/2433/2433-preview.mp3', loop: true, defaultVolume: 0.45, tags: ['water', 'peaceful'] },
  { id: 'cave-rumble', name: 'Cave Rumble', category: 'cave', url: 'https://assets.mixkit.co/active_storage/sfx/2016/2016-preview.mp3', loop: true, defaultVolume: 0.35, tags: ['deep', 'rumble'] },
  { id: 'combat-drums', name: 'Battle Drums', category: 'combat', url: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3', loop: true, defaultVolume: 0.6, tags: ['fight', 'tension'] },
  { id: 'combat-clash', name: 'Distant Clash', category: 'combat', url: 'https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3', loop: true, defaultVolume: 0.5, tags: ['swords', 'war'] },
  { id: 'ocean-waves', name: 'Ocean Waves', category: 'ocean', url: 'https://assets.mixkit.co/active_storage/sfx/2390/2390-preview.mp3', loop: true, defaultVolume: 0.55, tags: ['coast', 'sea'] },
  { id: 'temple-chant', name: 'Temple Ambience', category: 'temple', url: 'https://assets.mixkit.co/active_storage/sfx/2569/2569-preview.mp3', loop: true, defaultVolume: 0.4, tags: ['sacred', 'mystic'] },
  { id: 'city-market', name: 'Busy Market', category: 'city', url: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3', loop: true, defaultVolume: 0.5, tags: ['crowd', 'urban'] },
  { id: 'swamp-frogs', name: 'Swamp Night', category: 'swamp', url: 'https://assets.mixkit.co/active_storage/sfx/2434/2434-preview.mp3', loop: true, defaultVolume: 0.45, tags: ['wetland', 'night'] },
  { id: 'winter-wind', name: 'Winter Wind', category: 'winter', url: 'https://assets.mixkit.co/active_storage/sfx/2391/2391-preview.mp3', loop: true, defaultVolume: 0.5, tags: ['cold', 'howl'] },
  { id: 'fire-camp', name: 'Campfire', category: 'camp', url: 'https://assets.mixkit.co/active_storage/sfx/2469/2469-preview.mp3', loop: true, defaultVolume: 0.5, tags: ['outdoor', 'rest'] },
  { id: 'horror-whispers', name: 'Eerie Whispers', category: 'horror', url: 'https://assets.mixkit.co/active_storage/sfx/2017/2017-preview.mp3', loop: true, defaultVolume: 0.35, tags: ['scary', 'undead'] },
  { id: 'library-quiet', name: 'Quiet Library', category: 'library', url: 'https://assets.mixkit.co/active_storage/sfx/2567/2567-preview.mp3', loop: true, defaultVolume: 0.3, tags: ['study', 'indoor'] },
  { id: 'rain-light', name: 'Light Rain', category: 'forest', url: 'https://assets.mixkit.co/active_storage/sfx/2392/2392-preview.mp3', loop: true, defaultVolume: 0.5, tags: ['weather', 'rain'] },
  { id: 'rain-heavy', name: 'Heavy Rain', category: 'forest', url: 'https://assets.mixkit.co/active_storage/sfx/2393/2393-preview.mp3', loop: true, defaultVolume: 0.55, tags: ['weather', 'storm'] },
  { id: 'wind-howling', name: 'Howling Wind', category: 'wind', url: 'https://assets.mixkit.co/active_storage/sfx/2394/2394-preview.mp3', loop: true, defaultVolume: 0.45, tags: ['weather', 'mountain'] },
];

/** Music tracks for playlist / crossfade mode. */
export const MUSIC_LIBRARY: MediaLibraryEntry[] = [
  { id: 'music-explore', name: 'Exploration Theme', category: 'forest', url: 'https://assets.mixkit.co/active_storage/sfx/2560/2560-preview.mp3', loop: true, defaultVolume: 0.5, tags: ['travel'] },
  { id: 'music-tension', name: 'Rising Tension', category: 'combat', url: 'https://assets.mixkit.co/active_storage/sfx/2561/2561-preview.mp3', loop: true, defaultVolume: 0.55, tags: ['suspense'] },
  { id: 'music-boss', name: 'Boss Encounter', category: 'combat', url: 'https://assets.mixkit.co/active_storage/sfx/2562/2562-preview.mp3', loop: true, defaultVolume: 0.6, tags: ['boss'] },
  { id: 'music-tavern', name: 'Tavern Lute', category: 'tavern', url: 'https://assets.mixkit.co/active_storage/sfx/2563/2563-preview.mp3', loop: true, defaultVolume: 0.45, tags: ['social'] },
  { id: 'music-mystery', name: 'Mystery Motif', category: 'temple', url: 'https://assets.mixkit.co/active_storage/sfx/2564/2564-preview.mp3', loop: true, defaultVolume: 0.45, tags: ['investigation'] },
  { id: 'music-victory', name: 'Victory Stinger', category: 'combat', url: 'https://assets.mixkit.co/active_storage/sfx/2565/2565-preview.mp3', loop: false, defaultVolume: 0.6, tags: ['win'] },
];

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

export const WEATHER_PRESETS: Array<{ id: WeatherOverlay; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'rain', label: 'Rain' },
  { id: 'heavy-rain', label: 'Heavy Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'fog', label: 'Fog' },
  { id: 'storm', label: 'Storm' },
  { id: 'embers', label: 'Embers' },
  { id: 'leaves', label: 'Autumn Leaves' },
];

export const SCENE_TRANSITIONS: Array<{ id: SceneTransition; label: string }> = [
  { id: 'fade', label: 'Fade' },
  { id: 'page-turn', label: 'Page Turn' },
  { id: 'fire', label: 'Fire Wipe' },
  { id: 'none', label: 'Instant' },
];
