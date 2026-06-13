import type { LightingPreset, SceneTransition, TimeOfDay, WeatherOverlay } from '../types/scene';

/** Scene atmosphere presets (lighting, time, weather, transitions). Media uses Upload only. */

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
