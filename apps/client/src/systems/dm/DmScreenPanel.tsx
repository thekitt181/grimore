import { DraggablePanel } from '@/components/DraggablePanel';
import { useSessionStore } from '@/store/sessionStore';
import { ddbPanelPosition, ddbPanelWidth } from '@/systems/ddb/ddbTokenUtils';
import { isMobileClient } from '@/lib/socket';
import { useDmScreenStore, type DmScreenTab } from './dmScreenStore';
import { dmTabStyle } from './dmStyles';
import { PartyDdbTab } from './tabs/PartyDdbTab';
import { ConditionsRefTab } from './tabs/ConditionsRefTab';
import { EncounterTab } from './tabs/EncounterTab';
import { DmNotesTab } from './tabs/DmNotesTab';
import { SecretRollsTab } from './tabs/SecretRollsTab';

const TABS: { id: DmScreenTab; label: string }[] = [
  { id: 'party', label: 'Party' },
  { id: 'conditions', label: 'Conditions' },
  { id: 'encounters', label: 'Encounters' },
  { id: 'notes', label: 'Notes' },
  { id: 'rolls', label: 'Secret rolls' },
];

export function DmScreenPanel({ onClose }: { onClose: () => void }) {
  const sessionId = useSessionStore((s) => s.sessionId) ?? undefined;
  const tab = useDmScreenStore((s) => s.tab);
  const setTab = useDmScreenStore((s) => s.setTab);

  return (
    <DraggablePanel
      title="DM Screen"
      subtitle="Party · conditions · encounters · notes"
      onClose={onClose}
      defaultPosition={
        isMobileClient()
          ? ddbPanelPosition(8, 48)
          : { x: Math.max(16, window.innerWidth - 460), y: 72 }
      }
      width={ddbPanelWidth(420)}
      maxHeight="calc(100vh - 80px)"
      zIndex={145}
      footer="Powered by D&D Beyond where linked"
    >
      <div className="flex flex-col min-h-0 h-full">
        <div className="flex flex-wrap gap-0.5 p-2 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="text-[10px] px-2 py-0.5 rounded font-ui"
              style={dmTabStyle(tab === t.id)}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 text-xs font-ui">
          {tab === 'party' && <PartyDdbTab />}
          {tab === 'conditions' && <ConditionsRefTab />}
          {tab === 'encounters' && <EncounterTab />}
          {tab === 'notes' && sessionId ? <DmNotesTab sessionId={sessionId} /> : null}
          {tab === 'notes' && !sessionId && (
            <p style={{ color: 'var(--color-text-secondary)' }}>Join a session to save notes.</p>
          )}
          {tab === 'rolls' && <SecretRollsTab />}
        </div>
      </div>
    </DraggablePanel>
  );
}
