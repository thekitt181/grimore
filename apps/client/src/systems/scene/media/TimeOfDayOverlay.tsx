import { useEffect, useMemo, useRef } from 'react';
import type { TimeOfDay } from '@grimoire/shared';
import { getActiveTimeOfDay, useSceneMediaStore } from './sceneMediaStore';

interface TimeLayer {
  background?: string;
  opacity?: number;
  mixBlendMode?: React.CSSProperties['mixBlendMode'];
  boxShadow?: string;
  animation?: string;
}

const TIME_LAYERS: Record<TimeOfDay, TimeLayer[]> = {
  dawn: [
    {
      background: 'linear-gradient(to top, rgba(255, 120, 60, 0.35) 0%, rgba(255, 180, 100, 0.12) 35%, transparent 70%)',
      mixBlendMode: 'multiply',
    },
    {
      background: 'radial-gradient(ellipse 80% 50% at 15% 100%, rgba(255, 200, 120, 0.25), transparent 60%)',
      mixBlendMode: 'screen',
    },
    {
      background: 'rgba(255, 230, 200, 0.08)',
      mixBlendMode: 'soft-light',
    },
  ],
  day: [
    {
      background: 'rgba(255, 255, 255, 0.03)',
      mixBlendMode: 'soft-light',
    },
  ],
  'golden-hour': [
    {
      background: 'linear-gradient(135deg, rgba(255, 160, 60, 0.22) 0%, rgba(255, 100, 40, 0.08) 50%, rgba(80, 40, 120, 0.12) 100%)',
      mixBlendMode: 'multiply',
    },
    {
      boxShadow: 'inset 0 0 80px rgba(255, 140, 40, 0.18)',
    },
    {
      background: 'radial-gradient(ellipse 70% 60% at 85% 20%, rgba(255, 220, 140, 0.2), transparent 55%)',
      mixBlendMode: 'screen',
    },
  ],
  dusk: [
    {
      background: 'linear-gradient(to top, rgba(120, 60, 140, 0.3) 0%, rgba(255, 100, 60, 0.15) 30%, rgba(40, 50, 100, 0.2) 100%)',
      mixBlendMode: 'multiply',
    },
    {
      background: 'radial-gradient(ellipse 90% 40% at 50% 100%, rgba(255, 120, 60, 0.2), transparent 65%)',
      mixBlendMode: 'screen',
    },
  ],
  night: [
    {
      background: 'rgba(15, 25, 55, 0.42)',
      mixBlendMode: 'multiply',
    },
    {
      background: 'radial-gradient(ellipse 45% 35% at 82% 12%, rgba(180, 200, 255, 0.14), transparent 55%)',
      mixBlendMode: 'screen',
    },
    {
      boxShadow: 'inset 0 0 100px rgba(5, 10, 30, 0.55)',
    },
  ],
  midnight: [
    {
      background: 'rgba(5, 8, 20, 0.58)',
      mixBlendMode: 'multiply',
    },
    {
      background: 'radial-gradient(ellipse 35% 25% at 78% 8%, rgba(140, 160, 220, 0.1), transparent 50%)',
      mixBlendMode: 'screen',
    },
    {
      boxShadow: 'inset 0 0 140px rgba(0, 0, 0, 0.65)',
    },
  ],
};

function NightStarsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const c = canvas;
    const g = ctx;

    const stars: Array<{ x: number; y: number; r: number; phase: number }> = [];

    function resize() {
      const parent = c.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars.length = 0;
      for (let i = 0; i < 90; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.75,
          r: 0.4 + Math.random() * 1.2,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    resize();
    const ro = new ResizeObserver(resize);
    if (c.parentElement) ro.observe(c.parentElement);

    let raf = 0;
    function draw() {
      const w = c.clientWidth;
      const h = c.clientHeight;
      g.clearRect(0, 0, w, h);
      const t = Date.now() / 1000;
      for (const star of stars) {
        const alpha = 0.25 + Math.sin(t * 1.5 + star.phase) * 0.2 + Math.random() * 0.05;
        g.fillStyle = `rgba(220, 230, 255, ${alpha})`;
        g.beginPath();
        g.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        g.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full opacity-80" />;
}

export function TimeOfDayOverlay() {
  const timeOfDay = useSceneMediaStore(() => getActiveTimeOfDay());
  const layers = useMemo(() => TIME_LAYERS[timeOfDay], [timeOfDay]);
  const showStars = timeOfDay === 'night' || timeOfDay === 'midnight';

  if (timeOfDay === 'day') return null;

  return (
    <>
      {showStars && <NightStarsCanvas />}
      {layers.map((layer, i) => (
        <div
          key={i}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: layer.background,
            opacity: layer.opacity ?? 1,
            mixBlendMode: layer.mixBlendMode,
            boxShadow: layer.boxShadow,
            animation: layer.animation,
          }}
        />
      ))}
    </>
  );
}
