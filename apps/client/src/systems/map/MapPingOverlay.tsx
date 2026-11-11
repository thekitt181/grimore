import { useEffect, useState } from 'react';
import { PING_LIFE_MS, useMapPingStore } from './mapPingStore';
import { worldToPingClient } from './mapPingProject';

const GOLD = '#c9a84c';

export function MapPingOverlay() {
  const pings = useMapPingStore((s) => s.pings);
  const prune = useMapPingStore((s) => s.prune);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (pings.length === 0) return;
    let raf = 0;
    const loop = () => {
      prune();
      setTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pings.length, prune]);

  if (pings.length === 0) return null;

  const now = Date.now();

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden>
      {pings.map((ping) => {
        const screen = worldToPingClient(ping.x, ping.y);
        if (!screen) return null;
        const t = Math.min(1, (now - ping.startedAt) / PING_LIFE_MS);
        const opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        return (
          <div
            key={ping.pingId}
            className="absolute"
            style={{
              left: screen.x,
              top: screen.y,
              transform: 'translate(-50%, -50%)',
              opacity,
            }}
          >
            <span
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: 14,
                height: 14,
                marginLeft: -7,
                marginTop: -7,
                background: GOLD,
                boxShadow: `0 0 10px ${GOLD}`,
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: 28 + t * 70,
                height: 28 + t * 70,
                marginLeft: -(14 + t * 35),
                marginTop: -(14 + t * 35),
                border: `2px solid ${GOLD}`,
                opacity: 0.85 * (1 - t),
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: 12 + t * 110,
                height: 12 + t * 110,
                marginLeft: -(6 + t * 55),
                marginTop: -(6 + t * 55),
                border: `1px solid ${GOLD}`,
                opacity: 0.55 * (1 - t),
              }}
            />
            {ping.lookHere && (
              <div
                className="absolute left-1/2 font-ui whitespace-nowrap"
                style={{
                  top: 22,
                  transform: 'translateX(-50%)',
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: 'rgba(10,10,15,0.92)',
                  border: `1px solid ${GOLD}`,
                  color: GOLD,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                }}
              >
                Look here
                <span
                  className="block font-ui"
                  style={{ color: '#e8e0d0', fontSize: 10, fontWeight: 500, letterSpacing: 0 }}
                >
                  {ping.userName}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
