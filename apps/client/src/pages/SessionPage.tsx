import { useEffect, useLayoutEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import { useSocket } from '@/hooks/useSocket';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { MapCanvas } from '@/systems/map/MapCanvas';
import { MapToolbar } from '@/systems/map/MapToolbar';
import { MapSidebar } from '@/systems/map/MapSidebar';
import { ItemInspector } from '@/systems/scene/ItemInspector';
import { ItemContextMenu } from '@/systems/scene/ItemContextMenu';
import { DrawingTextInput } from '@/systems/map/DrawingTextInput';
import { DiceRoller } from '@/systems/dice/DiceRoller';
import { RollModeBar } from '@/systems/dice/RollModeBar';
import { RollToast } from '@/systems/dice/RollToast';
import { DiceTrayOverlay } from '@/systems/dice/DiceTrayOverlay';
import { AttackTargetPicker } from '@/systems/combat/AttackTargetPicker';
import { AttackTargetHint } from '@/systems/combat/AttackTargetHint';
import { AoePlacementHint } from '@/systems/combat/AoePlacementHint';
import { CombatResultToast } from '@/systems/combat/CombatResultToast';
import { TokenActionsPanel } from '@/systems/combat/TokenActionsPanel';
import { PcActionsPanel } from '@/systems/ddb/PcActionsPanel';
import { CharacterSheetPanel } from '@/systems/ddb/CharacterSheetPanel';
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary';
import { CharacterImportModal } from '@/systems/ddb/CharacterImportModal';
import { DdbEncounterPanel } from '@/systems/ddb/DdbEncounterPanel';
import { DdbLibraryPanel } from '@/systems/ddb/DdbLibraryPanel';
import { DdbLinkPanel } from '@/systems/ddb/DdbLinkPanel';
import { useDdbStore } from '@/systems/ddb/ddbStore';
import { useDdbHpSync } from '@/systems/ddb/useDdbHpSync';
import { useDdbSocket } from '@/systems/ddb/useDdbSocket';
import { useCombatStore } from '@/systems/combat/combatStore';
import { useDiceSocket } from '@/systems/dice/useDiceSocket';
import { InitiativeTracker } from '@/systems/initiative/InitiativeTracker';
import { MonsterDexPanel } from '@/systems/compendium/MonsterDexPanel';
import { ItemHandoutViewer } from '@/systems/compendium/ItemHandoutViewer';
import { useHandoutRevealSocket } from '@/systems/compendium/useHandoutRevealSocket';
import { useCompendiumSyncPoll } from '@/systems/compendium/useCompendiumSync';
import { useCompendiumUiStore } from '@/systems/compendium/compendiumStore';
import { getSocket, isMobileClient } from '@/lib/socket';
import { loadInitiativeLocal, persistInitiativeLocal } from '@/systems/scene/sessionPersistence';
import { useItemStore } from '@/systems/scene/store/itemStore';

interface SessionInfo {
  id: string;
  campaignId: string;
  campaignName: string;
  isActive: boolean;
  myRole: 'GM' | 'PLAYER';
  myUserId: string;
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    isConnected,
    connectionError,
    myRole,
    setMyRole,
    setMyUserId,
    setSession,
    clearSession,
    clearConnectionError,
  } = useSessionStore();
  const [retrySocket, setRetrySocket] = useState(0);
  const [socketReady, setSocketReady] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showInitiative, setShowInitiative] = useState(false);
  const panelOpen = useCompendiumUiStore((s) => s.panelOpen);
  const setPanelOpen = useCompendiumUiStore((s) => s.setPanelOpen);
  const tokenActionsToken = useCombatStore((s) => s.tokenActionsToken);
  const closeTokenActions = useCombatStore((s) => s.closeTokenActions);
  const isGM = myRole === 'GM';
  const hasMapItems = useItemStore((s) =>
    Object.values(s.items).some((i) => i.type === 'map'),
  );

  useCompendiumSyncPoll(socketReady);
  useDiceSocket();
  useDdbHpSync();
  useDdbSocket();

  const importModalOpen = useDdbStore((s) => s.importModalOpen);
  const importLinkTokenId = useDdbStore((s) => s.importLinkTokenId);
  const setImportModalOpen = useDdbStore((s) => s.setImportModalOpen);
  const sheetToken = useDdbStore((s) => s.sheetToken);
  const closeSheet = useDdbStore((s) => s.closeSheet);
  const pcActionsToken = useDdbStore((s) => s.pcActionsToken);
  const closePcActions = useDdbStore((s) => s.closePcActions);
  const encounterPanelOpen = useDdbStore((s) => s.encounterPanelOpen);
  const setEncounterPanelOpen = useDdbStore((s) => s.setEncounterPanelOpen);
  const libraryPanelOpen = useDdbStore((s) => s.libraryPanelOpen);
  const setLibraryPanelOpen = useDdbStore((s) => s.setLibraryPanelOpen);
  const linkPanelOpen = useDdbStore((s) => s.linkPanelOpen);
  const setLinkPanelOpen = useDdbStore((s) => s.setLinkPanelOpen);

  // ── Fetch session info ─────────────────────────────────────────────────────
  const { data: sessionInfo, isLoading } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      const res = await api.get<{ session: SessionInfo }>(`/sessions/${sessionId}`);
      return res.data.session;
    },
    enabled: !!sessionId,
    retry: 2,
  });

  // Set session id before child effects run (fog/items need this on first paint).
  useLayoutEffect(() => {
    if (!sessionInfo || !sessionId) return;
    setMyRole(sessionInfo.myRole);
    setSession(sessionId, sessionInfo.campaignId);
    setMyUserId(sessionInfo.myUserId);
    setSocketReady(true);
  }, [sessionInfo, sessionId, setMyRole, setSession, setMyUserId]);

  useEffect(() => () => clearSession(), [clearSession]);

  // ── Listen for initiative sync from server ─────────────────────────────────
  useEffect(() => {
    if (!socketReady || !sessionId) return;

    const saved = loadInitiativeLocal(sessionId);
    if (saved) {
      useInitiativeStore.getState().syncFromServer(saved);
    }

    const socket = getSocket();
    socket.on('initiative:sync', (payload) => {
      useInitiativeStore.getState().syncFromServer(payload);
      persistInitiativeLocal(sessionId, payload);
    });
    return () => { socket.off('initiative:sync'); };
  }, [socketReady, sessionId]);

  // ── Socket room management ─────────────────────────────────────────────────
  useSocket(
    socketReady ? (sessionId ?? null) : null,
    socketReady ? (sessionInfo?.campaignId ?? null) : null,
    retrySocket,
  );
  useHandoutRevealSocket(socketReady ? (sessionId ?? null) : null);

  const combatActive = useInitiativeStore((s) => s.isActive);
  useEffect(() => {
    if (combatActive) setShowInitiative(true);
  }, [combatActive]);

  useEffect(() => {
    if (!isGM) setPanelOpen(false);
  }, [isGM, setPanelOpen]);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <p className="font-display text-lg animate-torch" style={{ color: 'var(--color-accent-gold)' }}>
          Entering the dungeon...
        </p>
      </div>
    );
  }

  if (!sessionInfo) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--color-bg-primary)' }}>
        <p className="font-display text-xl" style={{ color: 'var(--color-accent-red-hot)' }}>Session not found.</p>
        <button className="btn-ghost" onClick={() => navigate('/')}>← Back to campaigns</button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--color-bg-primary)' }}>
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <header
        className="h-11 flex items-center justify-between px-4 shrink-0 z-10"
        style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/campaigns/${sessionInfo.campaignId}`)}
            className="font-ui text-xs transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)')}
          >
            ← {sessionInfo.campaignName}
          </button>
          <span style={{ color: 'var(--color-border)' }}>|</span>
          <span className="font-display text-sm tracking-widest animate-torch" style={{ color: 'var(--color-accent-gold)' }}>
            GRIMOIRE VTT
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: isConnected ? '#4ade80' : '#f87171' }}
              />
              <span className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {isConnected ? 'Live' : connectionError ? 'Offline' : 'Connecting...'}
              </span>
            </div>
            {connectionError && !isConnected && (
              <button
                type="button"
                className="btn-ghost text-[10px] py-0.5 px-2"
                onClick={() => {
                  clearConnectionError();
                  setRetrySocket((n) => n + 1);
                }}
              >
                Retry
              </button>
            )}
          </div>
          {myRole && (
            <span className={myRole === 'GM' ? 'badge-role-gm' : 'badge-role-player'}>
              {myRole}
            </span>
          )}
        </div>
      </header>

      {/* ── Main layout ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Toolbar */}
        <div className="p-2 flex flex-col items-start shrink-0 z-10">
          <MapToolbar />
        </div>

        {/* Map canvas + overlay panels */}
        <div className="flex-1 relative overflow-hidden">
          <MapCanvas />

          {!isGM && !hasMapItems && !isConnected && (
            <div
              className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-6 text-center pointer-events-none"
              style={{ background: 'rgba(10, 10, 15, 0.85)' }}
            >
              <p className="font-display text-lg animate-torch" style={{ color: 'var(--color-accent-gold)' }}>
                Connecting to the table…
              </p>
              <p className="font-ui text-sm max-w-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {isMobileClient()
                  ? 'Mobile connections can take up to a minute while the server wakes up. The map will appear once you are live.'
                  : 'Waiting for the live session link. The GM map will sync when you connect.'}
              </p>
              {connectionError && (
                <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>
                  {connectionError}
                </p>
              )}
            </div>
          )}

          {/* Right-click context menu */}
          <ItemContextMenu />

          {/* Inline text input for the text drawing tool */}
          <DrawingTextInput />

          <RollToast />
          <CombatResultToast />
          <AttackTargetPicker />
          <AttackTargetHint />
          <AoePlacementHint />
          {tokenActionsToken && (
            <TokenActionsPanel token={tokenActionsToken} onClose={closeTokenActions} />
          )}
          {pcActionsToken && (
            <PanelErrorBoundary title="Character actions failed" onReset={closePcActions}>
              <PcActionsPanel token={pcActionsToken} onClose={closePcActions} />
            </PanelErrorBoundary>
          )}
          {sheetToken && (
            <PanelErrorBoundary title="Character sheet failed" onReset={closeSheet}>
              <CharacterSheetPanel token={sheetToken} onClose={closeSheet} />
            </PanelErrorBoundary>
          )}
          {encounterPanelOpen && isGM && (
            <DdbEncounterPanel onClose={() => setEncounterPanelOpen(false)} />
          )}
          {libraryPanelOpen && isGM && (
            <DdbLibraryPanel onClose={() => setLibraryPanelOpen(false)} />
          )}
          {linkPanelOpen && isGM && (
            <DdbLinkPanel onClose={() => setLinkPanelOpen(false)} />
          )}
          {importModalOpen && (
            <CharacterImportModal
              {...(importLinkTokenId ? { linkTokenId: importLinkTokenId } : {})}
              onClose={() => setImportModalOpen(false)}
            />
          )}
          <DiceTrayOverlay />
          <ItemHandoutViewer />

          {/* Bottom dock — inspector (center) + tool panels (right), no overlap */}
          <div className="absolute bottom-0 inset-x-0 z-30 flex items-end gap-3 px-4 pb-4 pointer-events-none">
            <div className="flex-1 min-w-0 flex justify-center pointer-events-none">
              <div className="pointer-events-auto max-w-full">
                <ItemInspector />
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-2 pointer-events-auto">
              {showDice && <DiceRoller onClose={() => setShowDice(false)} />}
              {showInitiative && <InitiativeTracker onClose={() => setShowInitiative(false)} />}
              {isGM && panelOpen && <MonsterDexPanel onClose={() => setPanelOpen(false)} />}

              <RollModeBar />

              <div className="flex gap-2">
                {isGM && (
                  <button
                    onClick={() => setPanelOpen(!panelOpen)}
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-panel transition-all"
                    style={{
                      background: panelOpen ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
                      border: `1px solid ${panelOpen ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                      color: panelOpen ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                    }}
                    title="Compendium reference"
                  >
                    🐉
                  </button>
                )}
                <button
                  onClick={() => setShowInitiative((v) => !v)}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-panel transition-all"
                  style={{
                    background: showInitiative ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
                    border: `1px solid ${showInitiative ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                    color: showInitiative ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                  }}
                  title="Initiative tracker"
                >
                  ⚔
                </button>
                <button
                  onClick={() => setShowDice((v) => !v)}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-panel transition-all"
                  style={{
                    background: showDice ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
                    border: `1px solid ${showDice ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                    color: showDice ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                  }}
                  title="Dice roller"
                >
                  🎲
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <MapSidebar />
      </div>
    </div>
  );
}
