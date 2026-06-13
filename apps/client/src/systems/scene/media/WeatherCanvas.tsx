import { useEffect, useRef } from 'react';
import type { WeatherOverlay, WeatherSettings } from '@grimoire/shared';
import { DEFAULT_WEATHER_SETTINGS } from './sceneMediaStore';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
}

interface Splash {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

function windVector(settings: WeatherSettings, gust = 0): { vx: number; vy: number } {
  const speed = (settings.wind + gust) / 100;
  const rad = ((settings.direction + 90) * Math.PI) / 180;
  return {
    vx: Math.cos(rad) * speed * 4,
    vy: Math.sin(rad) * speed * 2 + 2,
  };
}

function spawnRain(w: number, h: number, settings: WeatherSettings, heavy: boolean, gust = 0): Particle {
  const wind = windVector(settings, gust);
  return {
    x: Math.random() * w,
    y: Math.random() * h - h,
    vx: wind.vx + (Math.random() - 0.5) * 1.5,
    vy: wind.vy * (heavy ? 2.2 : 1.6) + Math.random() * 2,
    size: heavy ? 1.2 + Math.random() * 1.2 : 0.6 + Math.random() * 0.8,
    alpha: 0.15 + Math.random() * 0.35,
  };
}

function spawnSnow(w: number, h: number, settings: WeatherSettings, gust = 0): Particle {
  const wind = windVector(settings, gust);
  return {
    x: Math.random() * w,
    y: -10,
    vx: wind.vx * 0.4 + (Math.random() - 0.5) * 0.8,
    vy: 0.6 + Math.random() * 1.2 + settings.wind / 200,
    size: 1 + Math.random() * 3,
    alpha: 0.4 + Math.random() * 0.5,
  };
}

function spawnEmber(w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: h + 10,
    vx: (Math.random() - 0.5) * 1.2,
    vy: -(1.2 + Math.random() * 2.5),
    size: 1 + Math.random() * 2.5,
    alpha: 0.5 + Math.random() * 0.5,
  };
}

function spawnLeaf(w: number, h: number, settings: WeatherSettings, gust = 0): Particle {
  const wind = windVector(settings, gust);
  return {
    x: -10,
    y: Math.random() * h,
    vx: 1.5 + wind.vx * 0.5 + Math.random(),
    vy: 0.3 + Math.random() * 0.8,
    size: 2 + Math.random() * 3,
    alpha: 0.45 + Math.random() * 0.4,
  };
}

interface WeatherCanvasProps {
  weather: Exclude<WeatherOverlay, 'none'>;
  settings?: WeatherSettings;
}

export function WeatherCanvas({ weather, settings = DEFAULT_WEATHER_SETTINGS }: WeatherCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const splashesRef = useRef<Splash[]>([]);
  const flashRef = useRef(0);
  const gustRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const c = canvas;
    const g = ctx;
    const density = settings.cover / 100;

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
    }

    resize();
    const ro = new ResizeObserver(resize);
    if (c.parentElement) ro.observe(c.parentElement);

    const targetCount = (() => {
      switch (weather) {
        case 'rain': return Math.floor(120 + density * 180);
        case 'heavy-rain': return Math.floor(200 + density * 350);
        case 'storm': return Math.floor(250 + density * 400);
        case 'snow': return Math.floor(80 + density * 160);
        case 'embers': return Math.floor(40 + density * 80);
        case 'leaves': return Math.floor(30 + density * 60);
        default: return 0;
      }
    })();

    particlesRef.current = [];
    splashesRef.current = [];

    function spawn(w: number, h: number) {
      const gust = gustRef.current;
      switch (weather) {
        case 'rain':
          return spawnRain(w, h, settings, false, gust);
        case 'heavy-rain':
        case 'storm':
          return spawnRain(w, h, settings, true, gust);
        case 'snow':
          return spawnSnow(w, h, settings, gust);
        case 'embers':
          return spawnEmber(w, h);
        case 'leaves':
          return spawnLeaf(w, h, settings, gust);
        default:
          return spawnRain(w, h, settings, false, gust);
      }
    }

    let lastFlash = 0;
    let lastGust = Date.now();

    function draw() {
      const w = c.clientWidth;
      const h = c.clientHeight;
      g.clearRect(0, 0, w, h);

      const now = Date.now();
      if (now - lastGust > 1800 + Math.random() * 2500) {
        gustRef.current = settings.wind * (0.4 + Math.random() * 0.8);
        lastGust = now;
      } else if (gustRef.current > 0) {
        gustRef.current *= 0.96;
        if (gustRef.current < 0.5) gustRef.current = 0;
      }

      if (weather === 'fog') {
        const t = Date.now() / 4000;
        const g1 = g.createRadialGradient(w * 0.3, h * 0.5, 0, w * 0.3, h * 0.5, w * 0.55);
        g1.addColorStop(0, `rgba(200, 210, 220, ${0.08 + density * 0.12})`);
        g1.addColorStop(1, 'rgba(200, 210, 220, 0)');
        g.fillStyle = g1;
        g.fillRect(0, 0, w, h);
        const g2 = g.createRadialGradient(
          w * (0.6 + Math.sin(t) * 0.1),
          h * (0.4 + Math.cos(t * 0.7) * 0.1),
          0,
          w * 0.65,
          h * 0.45,
          w * 0.5,
        );
        g2.addColorStop(0, `rgba(160, 175, 190, ${0.12 + density * 0.2})`);
        g2.addColorStop(1, 'rgba(160, 175, 190, 0)');
        g.fillStyle = g2;
        g.fillRect(0, 0, w, h);
        g.fillStyle = `rgba(140, 155, 170, ${0.05 + density * 0.08})`;
        g.fillRect(0, 0, w, h);
      } else {
        const pool = particlesRef.current;
        while (pool.length < targetCount) {
          pool.push(spawn(w, h));
        }

        for (let i = pool.length - 1; i >= 0; i--) {
          const p = pool[i]!;
          p.x += p.vx;
          p.y += p.vy;

          if (weather === 'embers') {
            p.alpha *= 0.996;
            p.vy -= 0.01;
          }

          const hitGround =
            (weather === 'rain' || weather === 'heavy-rain' || weather === 'storm')
            && p.y >= h - 8 - Math.random() * 24;

          if (hitGround) {
            splashesRef.current.push({
              x: p.x,
              y: h - 4 - Math.random() * 8,
              radius: 1 + Math.random() * (weather === 'storm' ? 4 : 2.5),
              alpha: 0.25 + Math.random() * 0.35,
            });
            pool[i] = spawn(w, h);
            continue;
          }

          const out =
            p.y > h + 20
            || p.x < -20
            || p.x > w + 20
            || p.y < -30
            || (weather === 'embers' && p.alpha < 0.05);

          if (out) {
            pool[i] = spawn(w, h);
            continue;
          }

          if (weather === 'rain' || weather === 'heavy-rain' || weather === 'storm') {
            g.strokeStyle = `rgba(180, 210, 255, ${p.alpha})`;
            g.lineWidth = p.size;
            g.beginPath();
            g.moveTo(p.x, p.y);
            g.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
            g.stroke();
          } else if (weather === 'snow') {
            g.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
            g.beginPath();
            g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            g.fill();
          } else if (weather === 'embers') {
            g.fillStyle = `rgba(255, ${120 + Math.random() * 60}, 40, ${p.alpha})`;
            g.beginPath();
            g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            g.fill();
          } else if (weather === 'leaves') {
            g.fillStyle = `rgba(180, 90, 30, ${p.alpha})`;
            g.beginPath();
            g.ellipse(p.x, p.y, p.size, p.size * 0.6, p.x * 0.01, 0, Math.PI * 2);
            g.fill();
          }
        }

        const splashes = splashesRef.current;
        for (let i = splashes.length - 1; i >= 0; i--) {
          const s = splashes[i]!;
          g.strokeStyle = `rgba(180, 210, 255, ${s.alpha})`;
          g.lineWidth = 1;
          g.beginPath();
          g.ellipse(s.x, s.y, s.radius * 1.6, s.radius * 0.45, 0, 0, Math.PI * 2);
          g.stroke();
          s.alpha *= 0.88;
          s.radius *= 1.04;
          if (s.alpha < 0.03) splashes.splice(i, 1);
        }
      }

      if (weather === 'storm') {
        if (now - lastFlash > 1800 + Math.random() * 3500) {
          if (Math.random() < 0.35 + density * 0.35) {
            flashRef.current = 1;
            lastFlash = now;
          }
        }
        if (flashRef.current > 0) {
          g.fillStyle = `rgba(220, 230, 255, ${flashRef.current * 0.45})`;
          g.fillRect(0, 0, w, h);
          flashRef.current *= 0.78;
          if (flashRef.current < 0.02) flashRef.current = 0;
        }
        g.fillStyle = `rgba(30, 45, 80, ${0.08 + density * 0.12})`;
        g.fillRect(0, 0, w, h);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [weather, settings.cover, settings.wind, settings.direction]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[15] h-full w-full"
      style={{ mixBlendMode: weather === 'snow' ? 'screen' : 'normal' }}
    />
  );
}
