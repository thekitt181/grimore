import {
  addGameMinutes,
  DEFAULT_GAME_TIME,
  formatGameTime,
  gameTimeToInputValue,
  normalizeGameTime,
} from '@grimoire/shared';
import { useSceneMediaStore } from './sceneMediaStore';
import { emitSessionGameTime } from './useSceneMedia';

interface GameClockWidgetProps {
  sessionId: string;
  isGM: boolean;
}

export function GameClockWidget({ sessionId, isGM }: GameClockWidgetProps) {
  const gameTime = useSceneMediaStore((s) => {
    const gt = s.activeScene?.gameTime ?? s.sessionGameTime;
    return gt ? normalizeGameTime(gt) : DEFAULT_GAME_TIME;
  });

  function setTime(next: ReturnType<typeof normalizeGameTime>) {
    emitSessionGameTime(sessionId, next);
  }

  if (!isGM) {
    return (
      <div
        className="flex items-center gap-1.5 rounded px-2 py-1 font-ui text-xs shrink-0"
        style={{
          background: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-accent-gold)',
        }}
        title="In-game time"
      >
        <span aria-hidden>🕐</span>
        <span className="tabular-nums tracking-wide">{formatGameTime(gameTime)}</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 rounded px-1.5 py-0.5 shrink-0"
      style={{
        background: 'var(--color-bg-tertiary)',
        border: '1px solid var(--color-border)',
      }}
      title="In-game time — synced to all players"
    >
      <button
        type="button"
        className="btn-ghost text-[10px] py-0.5 px-1"
        onClick={() => setTime(addGameMinutes(gameTime, -60))}
      >
        −1h
      </button>
      <button
        type="button"
        className="btn-ghost text-[10px] py-0.5 px-1"
        onClick={() => setTime(addGameMinutes(gameTime, -10))}
      >
        −10m
      </button>
      <input
        type="time"
        className="input text-xs py-0.5 px-1 w-[5.5rem] tabular-nums"
        value={gameTimeToInputValue(gameTime)}
        onChange={(e) => {
          const [hRaw, mRaw] = e.target.value.split(':');
          const h = Number(hRaw);
          const m = Number(mRaw);
          if (Number.isFinite(h) && Number.isFinite(m)) {
            setTime(normalizeGameTime({ hour: h, minute: m }));
          }
        }}
      />
      <span
        className="hidden sm:inline font-ui text-[10px] tabular-nums px-1"
        style={{ color: 'var(--color-accent-gold)' }}
      >
        {formatGameTime(gameTime)}
      </span>
      <button
        type="button"
        className="btn-ghost text-[10px] py-0.5 px-1"
        onClick={() => setTime(addGameMinutes(gameTime, 10))}
      >
        +10m
      </button>
      <button
        type="button"
        className="btn-ghost text-[10px] py-0.5 px-1"
        onClick={() => setTime(addGameMinutes(gameTime, 60))}
      >
        +1h
      </button>
    </div>
  );
}
