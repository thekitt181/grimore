import { useEffect, useState } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { itemCenter, type TokenItem } from '@/systems/scene/types';
import { tokenDisc } from '@/systems/scene/token/tokenGrid';
import { useSessionStore } from '@/store/sessionStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { worldToPingClient } from '@/systems/map/mapPingProject';
import { useVoiceStore } from './voiceStore';

const GOLD = '#c9a84c';

export function TokenVoicePulseOverlay() {
  const speakingByUserId = useVoiceStore((s) => s.speakingByUserId);
  const myRole = useSessionStore((s) => s.myRole);
  const viewMode = useMapStore((s) => s.viewMode);
  const gm2dEditorOpen = useMapStore((s) => s.gm2dEditorOpen);
  const items = useItemStore((s) => s.items);
  const [, setTick] = useState(0);
  const anyone = Object.keys(speakingByUserId).length > 0;

  useEffect(() => {
    if (!anyone) return;
    let raf = 0;
    const loop = () => {
      setTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anyone]);

  if (!anyone) return null;
  if (viewMode === '3d' && !gm2dEditorOpen) return null;

  const tokens = Object.values(items).filter((item): item is TokenItem => {
    if (item.type !== 'token') return false;
    const owner = item.ownerId?.trim();
    if (!owner || !speakingByUserId[owner]) return false;
    if (!item.visible && myRole !== 'GM') return false;
    return true;
  });

  if (tokens.length === 0) return null;

  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 140);

  return (
    <div className="pointer-events-none fixed inset-0 z-[68]" aria-hidden>
      {tokens.map((token) => {
        const { cx, cy } = itemCenter(token);
        const { radius } = tokenDisc(Math.min(token.width, token.height));
        const screen = worldToPingClient(cx, cy);
        const edge = worldToPingClient(cx + radius, cy);
        if (!screen) return null;
        const px = edge ? Math.hypot(edge.x - screen.x, edge.y - screen.y) : 22;
        const r = Math.max(10, px * (1.08 + pulse * 0.1));
        return (
          <span
            key={token.id}
            className="absolute rounded-full"
            style={{
              left: screen.x,
              top: screen.y,
              width: r * 2,
              height: r * 2,
              marginLeft: -r,
              marginTop: -r,
              border: `2px solid ${GOLD}`,
              boxShadow: `0 0 ${6 + pulse * 8}px ${GOLD}`,
              opacity: 0.4 + pulse * 0.45,
            }}
          />
        );
      })}
    </div>
  );
}
