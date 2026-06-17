import { useEffect, useLayoutEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@/lib/axios';
import { useSocket } from '@/hooks/useSocket';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { MapCanvas } from '@/systems/map/MapCanvas';
import { MapToolbar } from '@/systems/map/MapToolbar';
import { MapViewModeToggle } from '@/systems/map/MapViewModeToggle';
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
import { SpellTargetHint } from '@/systems/spells/SpellTargetHint';
import { AoePlacementHint } from '@/systems/combat/AoePlacementHint';
import { TokenMoveDistanceHint } from '@/systems/scene/interaction/TokenMoveDistanceHint';
import { ClearMapAreasButton } from '@/systems/combat/ClearMapAreasButton';
import { CombatResultToast } from '@/systems/combat/CombatResultToast';
import { TokenActionsPanel } from '@/systems/combat/TokenActionsPanel';
import { PcActionsPanel } from '@/systems/ddb/PcActionsPanel';
import { CharacterSheetPanel } from '@/systems/ddb/CharacterSheetPanel';
import { PanelErrorBoundary } from '@/components/PanelErrorBoundary';
import { CharacterImportModal } from '@/systems/ddb/CharacterImportModal';
import { DdbEncounterPanel } from '@/systems/ddb/DdbEncounterPanel';
import { DdbLibraryPanel } from '@/systems/ddb/DdbLibraryPanel';
import { DdbLinkPanel } from '@/systems/ddb/DdbLinkPanel';
import { MobileDdbTokenBar } from '@/systems/ddb/MobileDdbTokenBar';
import { useDdbStore } from '@/systems/ddb/ddbStore';
import { useDdbHpSync } from '@/systems/ddb/useDdbHpSync';
import { useDdbSocket } from '@/systems/ddb/useDdbSocket';
import { useCombatStore } from '@/systems/combat/combatStore';
import { useDiceSocket } from '@/systems/dice/useDiceSocket';
import { InitiativeTracker } from '@/systems/initiative/InitiativeTracker';
import { MobileSessionDock } from '@/components/MobileSessionDock';
import { MonsterDexPanel } from '@/systems/compendium/MonsterDexPanel';
import { ItemHandoutViewer } from '@/systems/compendium/ItemHandoutViewer';
import { useHandoutRevealSocket } from '@/systems/compendium/useHandoutRevealSocket';
import { HandoutManagerPanel } from '@/systems/handouts/HandoutManagerPanel';
import { HandoutJournalPanel } from '@/systems/handouts/HandoutJournalPanel';
import { useHandoutJournalStore } from '@/systems/handouts/handoutJournalStore';
import { useCompendiumSyncPoll } from '@/systems/compendium/useCompendiumSync';
import { CatalogRebuildBanner } from '@/systems/compendium/CatalogRebuildBanner';
import { useCompendiumAuthRecovery } from '@/systems/compendium/useCompendiumAuthRecovery';
import { useCompendiumUiStore } from '@/systems/compendium/compendiumStore';
import { getSocket, isMobileClient } from '@/lib/socket';
import type { InitiativeSyncPayload, SpellEffectSyncPayload, SpellEffectReminderPayload } from '@grimoire/shared';
import { loadInitiativeLocal, persistInitiativeLocal } from '@/systems/scene/sessionPersistence';
import {
  applyEffectReminderPayload,
  applySpellEffectSyncPayload,
  hydrateSpellEffectsFromLocal,
} from '@/systems/spells/effectSync';
import { useSpellEffectEngine } from '@/systems/spells/useSpellEffectEngine';
import { EffectReminderBanner } from '@/systems/spells/ActiveEffectsPanel';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSceneMedia } from '@/systems/scene/media/useSceneMedia';
import { BackgroundVideoLayer } from '@/systems/scene/media/BackgroundVideoLayer';
import { EmbedAudioLayer } from '@/systems/scene/media/EmbedAudioLayer';
import { SceneTransitionOverlay } from '@/systems/scene/media/SceneAtmosphere';
import { SessionMediaBar } from '@/systems/scene/media/SessionMediaBar';
import { GameClockWidget } from '@/systems/scene/media/GameClockWidget';
import { SessionSceneBar } from '@/systems/scene/manager/SessionSceneBar';
import { SceneManagerPanel } from '@/systems/scene/manager/SceneManagerPanel';
import { useSceneUiStore } from '@/systems/scene/manager/sceneUiStore';
import { DmScreenPanel } from '@/systems/dm/DmScreenPanel';
import { useDmScreenStore } from '@/systems/dm/dmScreenStore';
import { InviteCodeChip } from '@/components/campaign/InviteCodeChip';

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
  const [handoutManagerOpen, setHandoutManagerOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const loadHandoutJournal = useHandoutJournalStore((s) => s.loadJournal);
  const panelOpen = useCompendiumUiStore((s) => s.panelOpen);
  const setPanelOpen = useCompendiumUiStore((s) => s.setPanelOpen);
  const tokenActionsToken = useCombatStore((s) => s.tokenActionsToken);
  const closeTokenActions = useCombatStore((s) => s.closeTokenActions);
  const isGM = myRole === 'GM';
  const hasMapItems = useItemStore((s) =>
    Object.values(s.items).some((i) => i.type === 'map'),
  );

  useCompendiumSyncPoll(socketReady);
  useCompendiumAuthRecovery(socketReady);
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
  const sceneManagerOpen = useSceneUiStore((s) => s.sceneManagerOpen);
  const setSceneManagerOpen = useSceneUiStore((s) => s.setSceneManagerOpen);
  const dmScreenOpen = useDmScreenStore((s) => s.open);
  const setDmScreenOpen = useDmScreenStore((s) => s.setOpen);

  // ── Fetch session info ─────────────────────────────────────────────────────
  const { data: sessionInfo, isLoading } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      const res = await api.get<{ session: SessionInfo }>(`/sessions/${sessionId}`);
      return res.data.session;
    },
    enabled: !!sessionId,
    retry: (failureCount, error) => {
      if (axios.isAxiosError(error) && error.response?.status === 503) return failureCount < 5;
      return failureCount < 2;
    },
    retryDelay: (attempt) => Math.min(2000 * attempt, 8000),
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
    const onInitiativeSync = (payload: InitiativeSyncPayload) => {
      useInitiativeStore.getState().syncFromServer(payload);
      persistInitiativeLocal(sessionId, payload);
    };
    socket.on('initiative:sync', onInitiativeSync);
    return () => { socket.off('initiative:sync', onInitiativeSync); };
  }, [socketReady, sessionId]);

  // ── Spell effects sync (duration, concentration, VFX) ─────────────────────
  useEffect(() => {
    if (!socketReady || !sessionId) return;

    hydrateSpellEffectsFromLocal(sessionId);

    const socket = getSocket();
    const onEffectSync = (payload: SpellEffectSyncPayload) => {
      if (payload.sessionId !== sessionId) return;
      applySpellEffectSyncPayload(payload);
    };
    const onEffectRemind = (payload: SpellEffectReminderPayload) => {
      if (payload.sessionId !== sessionId) return;
      applyEffectReminderPayload(payload);
    };
    socket.on('effect:sync', onEffectSync);
    socket.on('effect:remind', onEffectRemind);
    return () => {
      socket.off('effect:sync', onEffectSync);
      socket.off('effect:remind', onEffectRemind);
    };
  }, [socketReady, sessionId]);

  // ── Socket room management ─────────────────────────────────────────────────
  useSocket(
    socketReady ? (sessionId ?? null) : null,
    socketReady ? (sessionInfo?.campaignId ?? null) : null,
    retrySocket,
  );
  useHandoutRevealSocket(socketReady ? (sessionId ?? null) : null);
  useSceneMedia(socketReady ? sessionId : undefined);
  useSpellEffectEngine();

  useEffect(() => {
    if (sessionInfo?.campaignId) {
      void loadHandoutJournal(sessionInfo.campaignId);
    }
  }, [sessionInfo?.campaignId, loadHandoutJournal]);

  const combatActive = useInitiativeStore((s) => s.isActive);
  const hasCombatants = useInitiativeStore((s) => s.combatants.length > 0);
  useEffect(() => {
    if (combatActive || (isMobileClient() && hasCombatants)) {
      setShowInitiative(true);
    }
  }, [combatActive, hasCombatants]);

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

        <div className="flex items-center gap-3 flex-wrap justify-end">
          {isGM && <InviteCodeChip campaignId={sessionInfo.campaignId} />}
          {isGM && (
            <>
              <SessionSceneBar
                campaignId={sessionInfo.campaignId}
                sessionId={sessionInfo.id}
                isGM={isGM}
              />
              <SessionMediaBar sessionId={sessionInfo.id} isGM={isGM} />
            </>
          )}
          <GameClockWidget sessionId={sessionInfo.id} isGM={isGM} />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: isConnected ? '#4ade80' : '#f87171' }}
              />
              <span
                className="font-ui text-xs"
                style={{ color: 'var(--color-text-secondary)' }}
                title={connectionError ?? undefined}
              >
                {isConnected
                  ? 'Live'
                  : connectionError?.includes('…')
                    ? connectionError
                    : connectionError
                      ? 'Offline'
                      : 'Reconnecting…'}
              </span>
            </div>
            {!isConnected && (
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
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Toolbar */}
        <div className="p-2 flex flex-col items-start shrink-0 z-10 h-full min-h-0 overflow-y-auto">
          <MapToolbar />
        </div>

        {/* Map canvas + overlay panels */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <MapCanvas />
          <SceneTransitionOverlay />
          <MobileDdbTokenBar />

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
          <SpellTargetHint />
          <AoePlacementHint />
          <TokenMoveDistanceHint />
          <ClearMapAreasButton />
          <EffectReminderBanner />
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
          {sceneManagerOpen && isGM && (
            <SceneManagerPanel onClose={() => setSceneManagerOpen(false)} />
          )}
          {handoutManagerOpen && isGM && sessionInfo && sessionId && (
            <HandoutManagerPanel
              campaignId={sessionInfo.campaignId}
              sessionId={sessionId}
              onClose={() => setHandoutManagerOpen(false)}
            />
          )}
          {journalOpen && sessionInfo && (
            <HandoutJournalPanel
              campaignId={sessionInfo.campaignId}
              onClose={() => setJournalOpen(false)}
            />
          )}
          {importModalOpen && (
            <CharacterImportModal
              {...(importLinkTokenId ? { linkTokenId: importLinkTokenId } : {})}
              onClose={() => setImportModalOpen(false)}
            />
          )}
          <DiceTrayOverlay />
          <ItemHandoutViewer />

          {showDice && <DiceRoller onClose={() => setShowDice(false)} />}
          {showInitiative && <InitiativeTracker onClose={() => setShowInitiative(false)} />}
          {isGM && panelOpen && <MonsterDexPanel onClose={() => setPanelOpen(false)} />}
          {isGM && dmScreenOpen && (
            <PanelErrorBoundary title="DM Screen failed" onReset={() => setDmScreenOpen(false)}>
              <DmScreenPanel onClose={() => setDmScreenOpen(false)} />
            </PanelErrorBoundary>
          )}

          <MobileSessionDock
            showInitiative={showInitiative}
            showDice={showDice}
            onToggleInitiative={() => setShowInitiative((v) => !v)}
            onToggleDice={() => setShowDice((v) => !v)}
          />

          {/* Bottom dock — inspector (center) + tool panels (right); hidden on mobile (use MobileSessionDock). */}
          <div className="absolute bottom-0 inset-x-0 z-30 hidden md:flex items-end gap-3 px-4 pb-4 pointer-events-none">
            <div className="flex-1 min-w-0 flex justify-center pointer-events-none">
              <div className="pointer-events-auto max-w-full">
                <ItemInspector />
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-2 pointer-events-auto">
              <RollModeBar />

              <div className="flex gap-2">
                <MapViewModeToggle variant="dock" />
                {isGM && (
                  <button
                    onClick={() => setHandoutManagerOpen(!handoutManagerOpen)}
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-panel transition-all"
                    style={{
                      background: handoutManagerOpen ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
                      border: `1px solid ${handoutManagerOpen ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                      color: handoutManagerOpen ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                    }}
                    title="Handouts"
                  >
                    📜
                  </button>
                )}
                <button
                  onClick={() => setJournalOpen(!journalOpen)}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-panel transition-all"
                  style={{
                    background: journalOpen ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
                    border: `1px solid ${journalOpen ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                    color: journalOpen ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                  }}
                  title="Handout journal"
                >
                  📖
                </button>
                {isGM && (
                  <button
                    onClick={() => setSceneManagerOpen(!sceneManagerOpen)}
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-panel transition-all"
                    style={{
                      background: sceneManagerOpen ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
                      border: `1px solid ${sceneManagerOpen ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                      color: sceneManagerOpen ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                    }}
                    title="Scene Manager"
                  >
                    🎬
                  </button>
                )}
                {isGM && (
                  <button
                    onClick={() => setDmScreenOpen(!dmScreenOpen)}
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shadow-panel transition-all"
                    style={{
                      background: dmScreenOpen ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
                      border: `1px solid ${dmScreenOpen ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
                      color: dmScreenOpen ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                    }}
                    title="DM Screen"
                  >
                    📋
                  </button>
                )}
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
      <BackgroundVideoLayer sessionId={sessionInfo.id} allowDismiss={isGM} />
      <EmbedAudioLayer />
      <CatalogRebuildBanner />
    </div>
  );
}
