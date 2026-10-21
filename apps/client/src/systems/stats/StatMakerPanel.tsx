import { useEffect, useMemo } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import {
  OVERALL_STATS_ID,
  buildOverallStatDoc,
  clearAllPlayerStats,
  downloadStatDocument,
  downloadStatDocumentJson,
  requestStatDocSync,
  effectiveCombatRounds,
  syncInitiativeRoundToAllPlayerStats,
  useStatMakerStore,
  type OverallStatDoc,
  type PlayerStatDoc,
} from './statMaker';

function fmt(t: number): string {
  try {
    return new Date(t).toLocaleString();
  } catch {
    return String(t);
  }
}

function entryPlayerName(entry: object): string | null {
  if (!('playerName' in entry)) return null;
  const name = (entry as { playerName?: unknown }).playerName;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/** Local adventure stats — per player + overall party rollup. */
export function StatMakerPanel() {
  const open = useStatMakerStore((s) => s.panelOpen);
  const docsById = useStatMakerStore((s) => s.docsById);
  const activeUserId = useStatMakerStore((s) => s.activeUserId);
  const setActiveUserId = useStatMakerStore((s) => s.setActiveUserId);
  const setPanelOpen = useStatMakerStore((s) => s.setPanelOpen);
  const ensureLocalDoc = useStatMakerStore((s) => s.ensureLocalDoc);
  const ensurePlayerDoc = useStatMakerStore((s) => s.ensurePlayerDoc);
  const refreshFromStorage = useStatMakerStore((s) => s.refreshFromStorage);
  const listPlayers = useStatMakerStore((s) => s.listPlayers);
  const connectedUsers = useSessionStore((s) => s.connectedUsers);
  const myRole = useSessionStore((s) => s.myRole);

  useEffect(() => {
    if (!open) return;
    refreshFromStorage();
    if (myRole !== 'GM') ensureLocalDoc();
    for (const u of connectedUsers) {
      if (u.role === 'GM') continue;
      if (myRole === 'GM' || u.id === useSessionStore.getState().myUserId) {
        ensurePlayerDoc({ userId: u.id, userName: u.username });
      }
    }
    requestStatDocSync();
  }, [open, connectedUsers, myRole, refreshFromStorage, ensureLocalDoc, ensurePlayerDoc]);

  const initRound = useInitiativeStore((s) => s.round);
  const initActive = useInitiativeStore((s) => s.isActive);

  // Persist in the background — chip reads initiative directly so it never waits on this.
  useEffect(() => {
    if (!open || !initActive || initRound < 1) return;
    const t = window.setTimeout(() => syncInitiativeRoundToAllPlayerStats(initRound), 0);
    return () => window.clearTimeout(t);
  }, [open, initActive, initRound]);

  const players = useMemo(() => listPlayers(), [listPlayers, docsById, connectedUsers, open]);
  const overall = useMemo(
    () => buildOverallStatDoc(docsById, players),
    [docsById, players, initActive, initRound],
  );
  const showOverall = activeUserId === OVERALL_STATS_ID;
  const doc: PlayerStatDoc | OverallStatDoc | null = showOverall
    ? overall
    : activeUserId
      ? docsById[activeUserId] ?? null
      : null;

  if (!open) return null;

  const uniqueObjects = doc ? new Set(doc.objectsInteracted.map((o) => o.name)).size : 0;
  const uniqueCreatures = doc ? new Set(doc.creaturesDefeated.map((c) => c.name)).size : 0;
  // Bound to initiative store subscription — updates on the same render as Round N.
  const displayedRounds = initActive && initRound >= 1
    ? initRound
    : (doc ? effectiveCombatRounds(doc) : 0);
  const downloadDoc = doc
    ? { ...doc, combatRounds: displayedRounds }
    : null;

  return (
    <div
      className="w-[min(92vw,24rem)] max-h-[min(calc(100vh-8rem),32rem)] flex flex-col overflow-hidden rounded-lg shadow-panel font-ui text-xs pointer-events-auto"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-gold)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div className="shrink-0 flex items-start justify-between gap-2 px-3 pt-3 pb-2">
        <div>
          <div className="font-display text-sm" style={{ color: 'var(--color-accent-gold)' }}>
            Stat Maker
          </div>
          <div className="opacity-60 text-[10px]">Per player + overall · synced in session</div>
        </div>
        <button type="button" className="btn-ghost text-[10px] px-1.5 py-0.5" onClick={() => setPanelOpen(false)}>
          Close
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <div className="flex flex-wrap gap-1 mb-3">
          <button
            type="button"
            className="px-2 py-1 rounded text-[10px]"
            style={{
              background: showOverall ? 'rgba(201,168,76,0.22)' : 'rgba(0,0,0,0.25)',
              border: `1px solid ${showOverall ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
              color: showOverall ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
            }}
            onClick={() => setActiveUserId(OVERALL_STATS_ID)}
          >
            Overall
          </button>
          {players.map((p) => {
            const active = !showOverall && p.userId === activeUserId;
            return (
              <button
                key={p.userId}
                type="button"
                className="px-2 py-1 rounded text-[10px]"
                style={{
                  background: active ? 'rgba(201,168,76,0.22)' : 'rgba(0,0,0,0.25)',
                  border: `1px solid ${active ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                  color: active ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                }}
                onClick={() => {
                  ensurePlayerDoc(p);
                  setActiveUserId(p.userId);
                }}
              >
                {p.userName}
              </button>
            );
          })}
        </div>

        {!doc ? (
          <p className="opacity-50">No player selected.</p>
        ) : (
          <>
            <div className="font-semibold mb-1" style={{ color: 'var(--color-accent-gold)' }}>
              {doc.userName}
            </div>
            {showOverall && overall.playerNames.length > 0 ? (
              <div className="opacity-60 text-[10px] mb-2">
                {overall.playerNames.join(' · ')}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-1.5 mb-3">
              <StatChip label="Objects" value={String(doc.objectsInteracted.length)} sub={`${uniqueObjects} unique`} />
              <StatChip label="Creatures slain" value={String(doc.creaturesDefeated.length)} sub={`${uniqueCreatures} unique`} />
              <StatChip label="Times downed" value={String(doc.timesDowned)} />
              <StatChip
                label="Combat rounds"
                value={String(displayedRounds)}
                {...(showOverall
                  ? { sub: 'party max' }
                  : initActive
                    ? { sub: `init r${initRound}` }
                    : {})}
              />
            </div>

            <section className="mb-2">
              <h3 className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--color-accent-gold)' }}>
                Objects (approved · rolled · free use)
              </h3>
              {doc.objectsInteracted.length === 0 ? (
                <p className="opacity-50">None yet.</p>
              ) : (
                <ul className="space-y-0.5 max-h-28 overflow-y-auto">
                  {doc.objectsInteracted.slice(0, 40).map((o) => (
                    <li key={o.id}>
                      <span className="opacity-50">{fmt(o.at)}</span>
                      {' — '}
                      <strong>{o.name}</strong>
                      <span className="opacity-60"> ({o.action})</span>
                      {entryPlayerName(o) ? (
                        <span className="opacity-50"> · {entryPlayerName(o)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mb-3">
              <h3 className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--color-accent-gold)' }}>
                Creatures defeated
              </h3>
              {doc.creaturesDefeated.length === 0 ? (
                <p className="opacity-50">None yet.</p>
              ) : (
                <ul className="space-y-0.5 max-h-28 overflow-y-auto">
                  {doc.creaturesDefeated.slice(0, 40).map((c) => (
                    <li key={c.id}>
                      <span className="opacity-50">{fmt(c.at)}</span>
                      {' — '}
                      <strong>{c.name}</strong>
                      {c.round != null ? <span className="opacity-60"> · r{c.round}</span> : null}
                      {entryPlayerName(c) ? (
                        <span className="opacity-50"> · {entryPlayerName(c)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-1"
                style={{ border: '1px solid var(--color-border-gold)' }}
                onClick={() => downloadDoc && downloadStatDocument(downloadDoc)}
              >
                Download {doc.userName}-stats.md
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-1"
                onClick={() => downloadDoc && downloadStatDocumentJson(downloadDoc)}
              >
                JSON
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-1"
                title="Wipe all player stats on every client in this session"
                onClick={() => {
                  if (window.confirm('Clear all adventure stats for every player in this session?')) {
                    clearAllPlayerStats(true);
                  }
                }}
              >
                Clear all
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] px-2 py-1"
                onClick={() => requestStatDocSync()}
              >
                Sync now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatChip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-md px-2 py-1.5"
      style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--color-border)' }}
    >
      <div className="opacity-60 text-[9px] uppercase">{label}</div>
      <div className="text-sm font-semibold" style={{ color: 'var(--color-accent-gold)' }}>{value}</div>
      {sub ? <div className="opacity-50 text-[9px]">{sub}</div> : null}
    </div>
  );
}
