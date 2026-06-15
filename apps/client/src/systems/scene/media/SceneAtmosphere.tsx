import { useMemo } from 'react';
import type { WeatherOverlay } from '@grimoire/shared';
import { useSceneMediaStore, selectEffectiveWeather } from './sceneMediaStore';
import { WeatherCanvas } from './WeatherCanvas';

const WEATHER_TINT: Partial<Record<Exclude<WeatherOverlay, 'none'>, string>> = {
  rain: 'rgba(80, 100, 140, 0.06)',
  'heavy-rain': 'rgba(60, 80, 120, 0.1)',
  storm: 'rgba(40, 50, 90, 0.15)',
  hail: 'rgba(100, 120, 160, 0.09)',
  snow: 'rgba(200, 220, 255, 0.08)',
  blizzard: 'rgba(180, 200, 230, 0.14)',
  fog: 'rgba(120, 130, 145, 0.12)',
  mist: 'rgba(160, 175, 190, 0.08)',
  sandstorm: 'rgba(160, 130, 80, 0.12)',
  swamp: 'rgba(60, 90, 50, 0.1)',
  ash: 'rgba(80, 80, 90, 0.14)',
  embers: 'rgba(80, 30, 10, 0.08)',
  leaves: 'rgba(60, 40, 20, 0.05)',
  fireflies: 'rgba(20, 40, 30, 0.12)',
  aurora: 'rgba(30, 50, 80, 0.1)',
};

const WEATHER_SETTINGS: Partial<
  Record<Exclude<WeatherOverlay, 'none'>, { cover: number; wind: number; direction: number }>
> = {
  rain: { cover: 55, wind: 35, direction: 195 },
  'heavy-rain': { cover: 80, wind: 55, direction: 190 },
  storm: { cover: 90, wind: 70, direction: 200 },
  hail: { cover: 75, wind: 45, direction: 195 },
  snow: { cover: 60, wind: 25, direction: 210 },
  blizzard: { cover: 95, wind: 85, direction: 220 },
  fog: { cover: 75, wind: 10, direction: 180 },
  mist: { cover: 50, wind: 15, direction: 175 },
  sandstorm: { cover: 85, wind: 90, direction: 270 },
  swamp: { cover: 65, wind: 12, direction: 180 },
  ash: { cover: 70, wind: 40, direction: 190 },
  embers: { cover: 50, wind: 30, direction: 170 },
  leaves: { cover: 45, wind: 50, direction: 90 },
  fireflies: { cover: 40, wind: 8, direction: 160 },
  aurora: { cover: 60, wind: 5, direction: 0 },
};

export function WeatherOverlay() {
  const activeScene = useSceneMediaStore((s) => s.activeScene);
  const sessionWeather = useSceneMediaStore((s) => s.sessionWeather);
  const sessionSettings = useSceneMediaStore((s) => s.sessionWeatherSettings);
  const weather = useMemo(
    () => selectEffectiveWeather({ activeScene, sessionWeather }),
    [activeScene, sessionWeather],
  );
  const tint = useMemo(() => {
    if (!weather) return null;
    return WEATHER_TINT[weather];
  }, [weather]);

  const settings = useMemo(() => {
    if (!weather) return sessionSettings;
    return { ...sessionSettings, ...WEATHER_SETTINGS[weather] };
  }, [weather, sessionSettings]);

  if (!weather) return null;

  return (
    <>
      {tint && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: tint }}
        />
      )}
      <WeatherCanvas weather={weather} settings={settings} />
    </>
  );
}

export function LightingTintOverlay() {
  const preset = useSceneMediaStore((s) => s.activeScene?.lightingPreset ?? 'default');
  const tint = useMemo(() => {
    switch (preset) {
      case 'torchlight': return 'rgba(255, 140, 40, 0.12)';
      case 'moonlight': return 'rgba(80, 120, 220, 0.18)';
      case 'overcast': return 'rgba(160, 170, 180, 0.15)';
      case 'underdark': return 'rgba(60, 20, 100, 0.28)';
      case 'ethereal': return 'rgba(80, 220, 240, 0.12)';
      case 'blood-moon': return 'rgba(180, 20, 30, 0.2)';
      default: return null;
    }
  }, [preset]);
  if (!tint) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ background: tint, mixBlendMode: 'multiply' }}
    />
  );
}

export function SceneTransitionOverlay() {
  const transitioning = useSceneMediaStore((s) => s.transitioning);
  const transition = useSceneMediaStore((s) => s.transition);
  if (!transitioning) return null;
  const bg =
    transition === 'fire'
      ? 'linear-gradient(135deg, rgba(255,90,0,0.85), rgba(80,0,0,0.9))'
      : transition === 'page-turn'
        ? 'linear-gradient(90deg, rgba(40,30,20,0.95) 0%, rgba(20,15,10,0.2) 100%)'
        : 'rgba(0,0,0,0.85)';
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[40] animate-pulse"
      style={{ background: bg, animationDuration: '0.85s', animationIterationCount: 1 }}
    />
  );
}
