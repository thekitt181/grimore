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
  phase?: number;
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

function spawnSnow(w: number, h: number, settings: WeatherSettings, gust = 0, blizzard = false): Particle {
  const wind = windVector(settings, gust);
  return {
    x: Math.random() * w,
    y: -10,
    vx: wind.vx * (blizzard ? 0.9 : 0.4) + (Math.random() - 0.5) * (blizzard ? 2 : 0.8),
    vy: (blizzard ? 1.4 : 0.6) + Math.random() * (blizzard ? 2.5 : 1.2) + settings.wind / 200,
    size: blizzard ? 0.8 + Math.random() * 2.2 : 1 + Math.random() * 3,
    alpha: 0.4 + Math.random() * 0.5,
  };
}

function spawnHail(w: number, h: number, settings: WeatherSettings, gust = 0): Particle {
  const wind = windVector(settings, gust);
  return {
    x: Math.random() * w,
    y: -10,
    vx: wind.vx * 0.6 + (Math.random() - 0.5),
    vy: 4 + Math.random() * 3 + settings.wind / 80,
    size: 1.5 + Math.random() * 2.5,
    alpha: 0.55 + Math.random() * 0.35,
  };
}

function spawnSand(w: number, h: number, settings: WeatherSettings, gust = 0): Particle {
  const wind = windVector(settings, gust);
  return {
    x: -20,
    y: Math.random() * h,
    vx: 3 + wind.vx * 1.2 + Math.random() * 2,
    vy: (Math.random() - 0.5) * 1.5,
    size: 0.8 + Math.random() * 2.5,
    alpha: 0.2 + Math.random() * 0.35,
  };
}

function spawnAsh(w: number, h: number, settings: WeatherSettings, gust = 0): Particle {
  const wind = windVector(settings, gust);
  return {
    x: Math.random() * w,
    y: -10,
    vx: wind.vx * 0.5 + Math.sin(Math.random() * 6) * 0.4,
    vy: 0.8 + Math.random() * 1.5,
    size: 1 + Math.random() * 2.5,
    alpha: 0.25 + Math.random() * 0.35,
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

function spawnFirefly(w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.3,
    size: 1.5 + Math.random() * 2,
    alpha: 0.3 + Math.random() * 0.5,
    phase: Math.random() * Math.PI * 2,
  };
}

function spawnSpore(w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: h + 5,
    vx: (Math.random() - 0.5) * 0.6,
    vy: -(0.3 + Math.random() * 0.8),
    size: 1 + Math.random() * 2,
    alpha: 0.2 + Math.random() * 0.3,
    phase: Math.random() * Math.PI * 2,
  };
}

function spawnMist(w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.15,
    vy: (Math.random() - 0.5) * 0.08,
    size: 20 + Math.random() * 40,
    alpha: 0.04 + Math.random() * 0.06,
  };
}

function isRainFamily(w: WeatherOverlay): boolean {
  return w === 'rain' || w === 'heavy-rain' || w === 'storm';
}

function isSnowFamily(w: WeatherOverlay): boolean {
  return w === 'snow' || w === 'blizzard';
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
        case 'hail': return Math.floor(90 + density * 140);
        case 'snow': return Math.floor(80 + density * 160);
        case 'blizzard': return Math.floor(180 + density * 320);
        case 'sandstorm': return Math.floor(160 + density * 280);
        case 'ash': return Math.floor(100 + density * 180);
        case 'embers': return Math.floor(40 + density * 80);
        case 'leaves': return Math.floor(30 + density * 60);
        case 'fireflies': return Math.floor(25 + density * 45);
        case 'swamp': return Math.floor(35 + density * 55);
        case 'mist': return Math.floor(12 + density * 18);
        default: return 0;
      }
    })();

    particlesRef.current = [];
    splashesRef.current = [];

    function spawn(w: number, h: number) {
      const gust = gustRef.current;
      switch (weather) {
        case 'rain': return spawnRain(w, h, settings, false, gust);
        case 'heavy-rain':
        case 'storm': return spawnRain(w, h, settings, true, gust);
        case 'hail': return spawnHail(w, h, settings, gust);
        case 'snow': return spawnSnow(w, h, settings, gust, false);
        case 'blizzard': return spawnSnow(w, h, settings, gust, true);
        case 'sandstorm': return spawnSand(w, h, settings, gust);
        case 'ash': return spawnAsh(w, h, settings, gust);
        case 'embers': return spawnEmber(w, h);
        case 'leaves': return spawnLeaf(w, h, settings, gust);
        case 'fireflies': return spawnFirefly(w, h);
        case 'swamp': return spawnSpore(w, h);
        case 'mist': return spawnMist(w, h);
        default: return spawnRain(w, h, settings, false, gust);
      }
    }

    function drawFog(w: number, h: number, variant: 'fog' | 'mist' | 'swamp') {
      const t = Date.now() / 4000;
      const palette =
        variant === 'swamp'
          ? { core: '80, 120, 70', edge: '50, 80, 45' }
          : variant === 'mist'
            ? { core: '210, 220, 230', edge: '180, 190, 200' }
            : { core: '200, 210, 220', edge: '160, 175, 190' };
      const intensity = variant === 'mist' ? 0.06 + density * 0.1 : 0.08 + density * 0.12;

      const g1 = g.createRadialGradient(w * 0.3, h * 0.5, 0, w * 0.3, h * 0.5, w * 0.55);
      g1.addColorStop(0, `rgba(${palette.core}, ${intensity})`);
      g1.addColorStop(1, `rgba(${palette.edge}, 0)`);
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
      g2.addColorStop(0, `rgba(${palette.edge}, ${intensity * 1.4})`);
      g2.addColorStop(1, `rgba(${palette.edge}, 0)`);
      g.fillStyle = g2;
      g.fillRect(0, 0, w, h);
    }

    function drawAurora(w: number, h: number) {
      const t = Date.now() / 3000;
      for (let i = 0; i < 4; i++) {
        const x = w * (0.15 + i * 0.22 + Math.sin(t + i) * 0.04);
        const band = g.createLinearGradient(x, 0, x + w * 0.12, h);
        const hue = i % 2 === 0 ? '80, 220, 160' : '100, 180, 255';
        band.addColorStop(0, `rgba(${hue}, 0)`);
        band.addColorStop(0.35, `rgba(${hue}, ${0.08 + density * 0.12})`);
        band.addColorStop(0.55, `rgba(${hue}, ${0.12 + density * 0.15})`);
        band.addColorStop(0.75, `rgba(${hue}, ${0.06 + density * 0.08})`);
        band.addColorStop(1, `rgba(${hue}, 0)`);
        g.fillStyle = band;
        g.fillRect(0, 0, w, h);
      }
      g.fillStyle = `rgba(120, 200, 255, ${0.03 + density * 0.04})`;
      g.fillRect(0, 0, w, h * 0.35);
    }

    let lastFlash = 0;
    let lastGust = Date.now();

    function drawParticle(p: Particle, w: number, h: number, now: number) {
      if (weather === 'sandstorm') {
        g.strokeStyle = `rgba(210, 170, 110, ${p.alpha})`;
        g.lineWidth = p.size;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 4, p.y - p.vy * 2);
        g.stroke();
        return;
      }
      if (isRainFamily(weather)) {
        g.strokeStyle = `rgba(180, 210, 255, ${p.alpha})`;
        g.lineWidth = p.size;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
        g.stroke();
        return;
      }
      if (weather === 'hail') {
        g.fillStyle = `rgba(230, 240, 255, ${p.alpha})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
        return;
      }
      if (isSnowFamily(weather)) {
        g.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
        return;
      }
      if (weather === 'ash') {
        g.fillStyle = `rgba(120, 120, 130, ${p.alpha})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
        return;
      }
      if (weather === 'embers') {
        g.fillStyle = `rgba(255, ${120 + Math.random() * 60}, 40, ${p.alpha})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
        return;
      }
      if (weather === 'leaves') {
        g.fillStyle = `rgba(180, 90, 30, ${p.alpha})`;
        g.beginPath();
        g.ellipse(p.x, p.y, p.size, p.size * 0.6, p.x * 0.01, 0, Math.PI * 2);
        g.fill();
        return;
      }
      if (weather === 'fireflies') {
        const pulse = 0.4 + Math.sin(now / 400 + (p.phase ?? 0)) * 0.35;
        g.fillStyle = `rgba(180, 255, 90, ${p.alpha * pulse})`;
        g.shadowBlur = 8;
        g.shadowColor = 'rgba(180, 255, 90, 0.6)';
        g.beginPath();
        g.arc(p.x, p.y, p.size * pulse, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
        return;
      }
      if (weather === 'swamp') {
        const pulse = 0.5 + Math.sin(now / 600 + (p.phase ?? 0)) * 0.3;
        g.fillStyle = `rgba(140, 220, 100, ${p.alpha * pulse})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
        return;
      }
      if (weather === 'mist') {
        g.fillStyle = `rgba(255, 255, 255, ${p.alpha})`;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
      }
    }

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

      if (weather === 'aurora') {
        drawAurora(w, h);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      if (weather === 'fog' || weather === 'mist' || weather === 'swamp') {
        drawFog(w, h, weather);
      }

      if (targetCount > 0) {
        const pool = particlesRef.current;
        while (pool.length < targetCount) {
          pool.push(spawn(w, h));
        }

        for (let i = pool.length - 1; i >= 0; i--) {
          const p = pool[i]!;
          p.x += p.vx;
          p.y += p.vy;

          if (weather === 'fireflies') {
            p.x += Math.sin(now / 800 + (p.phase ?? 0)) * 0.3;
            p.y += Math.cos(now / 900 + (p.phase ?? 0)) * 0.25;
          }

          if (weather === 'embers') {
            p.alpha *= 0.996;
            p.vy -= 0.01;
          }

          const hitGround =
            (isRainFamily(weather) || weather === 'hail')
            && p.y >= h - 8 - Math.random() * 24;

          if (hitGround) {
            const splashColor = weather === 'hail' ? 0.35 : 0.25;
            splashesRef.current.push({
              x: p.x,
              y: h - 4 - Math.random() * 8,
              radius: 1 + Math.random() * (weather === 'storm' || weather === 'hail' ? 4 : 2.5),
              alpha: splashColor + Math.random() * 0.35,
            });
            pool[i] = spawn(w, h);
            continue;
          }

          const out =
            p.y > h + 20
            || p.x < -40
            || p.x > w + 40
            || p.y < -30
            || (weather === 'embers' && p.alpha < 0.05)
            || (weather === 'swamp' && p.y < -20);

          if (out) {
            pool[i] = spawn(w, h);
            continue;
          }

          drawParticle(p, w, h, now);
        }

        const splashes = splashesRef.current;
        for (let i = splashes.length - 1; i >= 0; i--) {
          const s = splashes[i]!;
          g.strokeStyle = `rgba(200, 220, 255, ${s.alpha})`;
          g.lineWidth = 1;
          g.beginPath();
          g.ellipse(s.x, s.y, s.radius * 1.6, s.radius * 0.45, 0, 0, Math.PI * 2);
          g.stroke();
          s.alpha *= 0.88;
          s.radius *= 1.04;
          if (s.alpha < 0.03) splashes.splice(i, 1);
        }
      }

      if (weather === 'storm' || weather === 'blizzard') {
        if (now - lastFlash > 1800 + Math.random() * 3500) {
          if (Math.random() < 0.25 + density * 0.3) {
            flashRef.current = 1;
            lastFlash = now;
          }
        }
        if (flashRef.current > 0) {
          g.fillStyle = `rgba(220, 230, 255, ${flashRef.current * 0.4})`;
          g.fillRect(0, 0, w, h);
          flashRef.current *= 0.78;
          if (flashRef.current < 0.02) flashRef.current = 0;
        }
      }

      if (weather === 'storm') {
        g.fillStyle = `rgba(30, 45, 80, ${0.08 + density * 0.12})`;
        g.fillRect(0, 0, w, h);
      }

      if (weather === 'sandstorm') {
        g.fillStyle = `rgba(140, 110, 60, ${0.06 + density * 0.1})`;
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

  const blendMode =
    weather === 'snow' || weather === 'blizzard' || weather === 'fireflies' || weather === 'aurora'
      ? 'screen'
      : 'normal';

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[15] h-full w-full"
      style={{ mixBlendMode: blendMode }}
    />
  );
}
