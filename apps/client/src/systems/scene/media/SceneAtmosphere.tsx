import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { WeatherOverlay } from '@grimoire/shared';
import { useSceneMediaStore } from './sceneMediaStore';

const WEATHER_STYLES: Record<Exclude<WeatherOverlay, 'none'>, CSSProperties> = {
  rain: {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='40' viewBox='0 0 4 40'%3E%3Cline x1='2' y1='0' x2='2' y2='14' stroke='rgba(180,210,255,0.35)' stroke-width='1'/%3E%3C/svg%3E")`,
    animation: 'grimoire-rain 0.45s linear infinite',
  },
  'heavy-rain': {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='50' viewBox='0 0 6 50'%3E%3Cline x1='3' y1='0' x2='3' y2='18' stroke='rgba(160,190,255,0.55)' stroke-width='1.5'/%3E%3C/svg%3E")`,
    animation: 'grimoire-rain 0.25s linear infinite',
  },
  snow: {
    backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)`,
    backgroundSize: '18px 18px',
    animation: 'grimoire-snow 6s linear infinite',
  },
  fog: {
    background: 'radial-gradient(ellipse at center, rgba(200,210,220,0.15) 0%, rgba(120,130,140,0.35) 100%)',
    animation: 'grimoire-fog 8s ease-in-out infinite alternate',
  },
  storm: {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='40' viewBox='0 0 4 40'%3E%3Cline x1='2' y1='0' x2='2' y2='14' stroke='rgba(180,210,255,0.45)' stroke-width='1'/%3E%3C/svg%3E")`,
    animation: 'grimoire-rain 0.2s linear infinite',
    boxShadow: 'inset 0 0 120px rgba(40,60,100,0.4)',
  },
  embers: {
    backgroundImage: `radial-gradient(circle, rgba(255,120,40,0.8) 1px, transparent 2px)`,
    backgroundSize: '24px 24px',
    animation: 'grimoire-embers 4s linear infinite',
  },
  leaves: {
    backgroundImage: `radial-gradient(ellipse, rgba(180,100,30,0.7) 2px, transparent 3px)`,
    backgroundSize: '32px 32px',
    animation: 'grimoire-leaves 5s linear infinite',
  },
};

export function WeatherOverlay() {
  const weather = useSceneMediaStore((s) => s.activeScene?.weatherOverlay);
  const style = useMemo(() => {
    if (!weather || weather === 'none') return null;
    return WEATHER_STYLES[weather];
  }, [weather]);

  if (!style) return null;

  return (
    <>
      <style>{`
        @keyframes grimoire-rain { from { background-position: 0 0; } to { background-position: -12px 120px; } }
        @keyframes grimoire-snow { from { background-position: 0 0; } to { background-position: 20px 200px; } }
        @keyframes grimoire-fog { from { opacity: 0.35; } to { opacity: 0.65; } }
        @keyframes grimoire-embers { from { background-position: 0 0; } to { background-position: 0 -120px; } }
        @keyframes grimoire-leaves { from { background-position: 0 0; } to { background-position: 40px 160px; } }
      `}</style>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[15]"
        style={{ ...style, mixBlendMode: 'screen' }}
      />
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
      className="pointer-events-none absolute inset-0 z-[14]"
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
