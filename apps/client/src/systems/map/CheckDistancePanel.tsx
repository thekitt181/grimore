import { tokenDistanceBreakdown, tokenFlyHeightFt } from '@/systems/combat/attackRange';
import { useMapStore } from './store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useSessionStore } from '@/store/sessionStore';
import { sceneTokensForClient } from '@/systems/scene/sceneMapsForClient';
import type { TokenItem } from '@/systems/scene/types';

function formatFt(n: number): string {
  return `${n} ft`;
}

function withLivePose(token: TokenItem): TokenItem {
  const live = useLiveTransformStore.getState().byId[token.id];
  if (!live) return token;
  return {
    ...token,
    x: live.x ?? token.x,
    y: live.y ?? token.y,
    width: live.width ?? token.width,
    height: live.height ?? token.height,
  };
}

export function CheckDistancePanel({ onClose }: { onClose: () => void }) {
  const fromId = useMapStore((s) => s.checkDistanceFromId);
  const items = useItemStore((s) => s.items);
  useLiveTransformStore((s) => s.tick);
  const isGM = useSessionStore((s) => s.myRole === 'GM');

  const originRaw = fromId ? items[fromId] : undefined;
  const origin = originRaw?.type === 'token' ? withLivePose(originRaw) : null;
  const others = sceneTokensForClient(items, isGM)
    .filter((t) => t.id !== origin?.id)
    .map(withLivePose);

  const rows = origin
    ? others
        .map((t) => {
          const d = tokenDistanceBreakdown(origin, t);
          return { token: t, ...d };
        })
        .sort((a, b) => a.distanceFt - b.distanceFt || a.token.name.localeCompare(b.token.name))
    : [];

  const originFly = origin ? tokenFlyHeightFt(origin) : 0;

  return (
    <div
      className="rounded-lg shadow-panel p-2.5 w-[240px] max-h-[min(480px,72vh)] overflow-y-auto"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-gold)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className="font-display text-[10px] tracking-wider uppercase"
          style={{ color: 'var(--color-accent-gold)' }}
        >
          Distance
        </span>
        <button type="button" className="btn-ghost text-[10px] py-0 px-1.5" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="font-ui text-[10px] leading-snug mb-2" style={{ color: 'var(--color-text-secondary)' }}>
        Click a token. Distances from that token to every other token.
      </p>
      {!origin && (
        <p className="font-ui text-xs" style={{ color: 'var(--color-text-primary)' }}>
          Click a token on the map.
        </p>
      )}
      {origin && (
        <div className="flex flex-col gap-1.5">
          <p className="font-ui text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            From {origin.name}
            {originFly > 0 ? ` · ↑${originFly} ft` : ''}
          </p>
          {rows.length === 0 && (
            <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
              No other tokens on the map.
            </p>
          )}
          {rows.map((row) => (
            <div key={row.token.id} className="flex items-baseline justify-between gap-2">
              <span className="font-ui text-xs truncate" style={{ color: 'var(--color-text-primary)' }}>
                {row.token.name}
                {tokenFlyHeightFt(row.token) > 0 ? ` ↑${tokenFlyHeightFt(row.token)}` : ''}
              </span>
              <span
                className="font-ui text-xs tabular-nums shrink-0"
                style={{ color: 'var(--color-accent-gold)' }}
                {...(row.heightFt > 0
                  ? { title: `Map ${row.mapFt} ft · height ${row.heightFt} ft` }
                  : {})}
              >
                {formatFt(row.distanceFt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
