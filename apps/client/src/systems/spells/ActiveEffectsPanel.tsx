import { useSpellEffectStore } from './effectStore';
import { endSpellEffect } from './castSpellEffect';
import { syncSpellEffectsToServer } from './effectSync';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { resolveConcentrationSave } from './concentrationManager';
import { jb2aAnimationsEnabled } from './spellVfxRegistry';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function RoundsPerMinuteSetting() {
  const settings = useSpellEffectStore((s) => s.settings);

  return (
    <div
      className="rounded px-2 py-1.5 space-y-1"
      style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
    >
      <p className="font-ui text-[9px] uppercase tracking-wide" style={{ color: GOLD }}>
        Combat timing
      </p>
      <label className="font-ui text-[10px] flex items-center justify-between gap-2" style={{ color: 'var(--color-text-primary)' }}>
        Rounds per minute
        <input
          type="number"
          min={1}
          max={60}
          value={settings.roundsPerMinute}
          onChange={(e) => {
            const n = Math.max(1, Number(e.target.value) || 10);
            useSpellEffectStore.getState().setSettings({ roundsPerMinute: n });
            syncSpellEffectsToServer();
          }}
          className="w-12 px-1 py-0.5 rounded text-center"
          style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${BD}`, color: 'var(--color-text-primary)' }}
        />
      </label>
      <p className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
        D&amp;D default is 10 (6 seconds per round). Used to convert spell durations in minutes/hours to combat rounds.
      </p>
    </div>
  );
}

function Jb2aSettingsRow() {
  const settings = useSpellEffectStore((s) => s.settings);
  const enabled = jb2aAnimationsEnabled();

  return (
    <div
      className="rounded px-2 py-1.5 space-y-1"
      style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
    >
      <p className="font-ui text-[9px] uppercase tracking-wide" style={{ color: GOLD }}>
        Spell animations (JB2A)
      </p>
      <input
        type="url"
        placeholder="Library base URL (e.g. /jb2a/Library)"
        value={settings.jb2aBaseUrl ?? ''}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const store = useSpellEffectStore.getState();
          if (raw) {
            store.setSettings({ jb2aBaseUrl: raw });
          } else {
            const next = { ...store.settings };
            delete next.jb2aBaseUrl;
            store.syncFromServer(store.effects, next);
          }
          syncSpellEffectsToServer();
        }}
        className="w-full px-1.5 py-1 rounded font-ui text-[10px]"
        style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${BD}`, color: 'var(--color-text-primary)' }}
      />
      <p className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
        {enabled
          ? 'WebM bursts enabled — point at your JB2A Library folder.'
          : 'Leave blank for gold zones only. Set VITE_JB2A_BASE_URL or paste a URL here.'}
      </p>
    </div>
  );
}

function formatRemaining(effect: ReturnType<typeof useSpellEffectStore.getState>['effects'][0]): string {
  const d = effect.duration;
  if (d.kind === 'untilDispelled') return 'Until dispelled';
  if (d.totalRounds != null) {
    const elapsed = Math.max(0, useInitiativeStore.getState().round - effect.startedRound);
    const left = Math.max(0, d.totalRounds - elapsed);
    if (d.kind === 'minutes' && d.remaining != null) {
      return `${left} rd · ${d.label}`;
    }
    return `${left} round${left === 1 ? '' : 's'}`;
  }
  return d.label;
}

export function ActiveEffectsPanel() {
  const effects = useSpellEffectStore((s) => s.effects.filter((e) => !e.ended));
  const round = useInitiativeStore((s) => s.round);

  if (effects.length === 0) {
    return (
      <div className="space-y-2">
        <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          No active spell effects
        </p>
        <RoundsPerMinuteSetting />
        <Jb2aSettingsRow />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-ui text-[10px] uppercase tracking-wide" style={{ color: GOLD }}>
          Active effects · R{round}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="font-ui text-[9px] px-1.5 py-0.5 rounded"
            style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
            onClick={() => {
              for (const effect of [...effects]) {
                endSpellEffect(effect.id, 'manual');
              }
            }}
          >
            End all
          </button>
        </div>
      </div>
      {effects.map((effect) => (
        <div
          key={effect.id}
          className="rounded px-2 py-1.5 space-y-1"
          style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-ui text-xs" style={{ color: 'var(--color-text-primary)' }}>
                {effect.spellName}
                {effect.concentration && (
                  <span className="ml-1 text-[9px]" style={{ color: GOLD }}>CON</span>
                )}
              </p>
              <p className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
                {effect.casterName} · {formatRemaining(effect)}
              </p>
            </div>
            <button
              type="button"
              className="font-ui text-[9px] px-1.5 py-0.5 rounded shrink-0"
              style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
              onClick={() => endSpellEffect(effect.id, 'manual')}
            >
              End
            </button>
          </div>
        </div>
      ))}
      <RoundsPerMinuteSetting />
      <Jb2aSettingsRow />
    </div>
  );
}

export function EffectReminderBanner() {
  const reminders = useSpellEffectStore((s) => s.reminders);

  if (reminders.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 max-w-md w-[min(92vw,420px)]">
      {reminders.map((r) => (
        <div
          key={`${r.kind}-${r.effectId}`}
          className="rounded-lg px-3 py-2 shadow-lg"
          style={{
            background: 'rgba(20,18,14,0.95)',
            border: `1px solid ${GOLD}`,
            color: 'var(--color-text-primary)',
          }}
        >
          <p className="font-ui text-xs">{r.message}</p>
          {r.kind === 'concentration-save' && (
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                className="font-ui text-[10px] px-2 py-1 rounded flex-1"
                style={{ background: 'rgba(34,197,94,0.2)', border: '1px solid #22c55e', color: '#86efac' }}
                onClick={() => resolveConcentrationSave(r.effectId, true)}
              >
                Passed
              </button>
              <button
                type="button"
                className="font-ui text-[10px] px-2 py-1 rounded flex-1"
                style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', color: '#fca5a5' }}
                onClick={() => resolveConcentrationSave(r.effectId, false)}
              >
                Failed
              </button>
            </div>
          )}
          {r.kind !== 'concentration-save' && (
            <button
              type="button"
              className="font-ui text-[10px] mt-2 opacity-70"
              onClick={() => useSpellEffectStore.getState().dismissReminder(r.effectId, r.kind)}
            >
              Dismiss
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
