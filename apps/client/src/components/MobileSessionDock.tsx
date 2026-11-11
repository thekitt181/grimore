import { MapViewModeToggle } from '@/systems/map/MapViewModeToggle';
import { QuestDock } from '@/systems/quests/QuestDock';
import { joinVoice, leaveVoice, setVoiceMuted } from '@/systems/voice/voiceEngine';
import { useVoiceStore } from '@/systems/voice/voiceStore';
import { useSessionRecapStore } from '@/systems/voice/sessionRecapStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export function MobileSessionDock({
  showInitiative,
  showDice,
  showQuests,
  onToggleInitiative,
  onToggleDice,
  onToggleQuests,
  onImportPc,
}: {
  showInitiative: boolean;
  showDice: boolean;
  showQuests: boolean;
  onToggleInitiative: () => void;
  onToggleDice: () => void;
  onToggleQuests: () => void;
  onImportPc?: () => void;
}) {
  const inVoice = useVoiceStore((s) => s.joined);
  const muted = useVoiceStore((s) => s.muted);
  const joining = useVoiceStore((s) => s.joining);
  const recapOpen = useSessionRecapStore((s) => s.open);
  const toggleRecap = useSessionRecapStore((s) => s.toggleOpen);

  return (
    <div
      className="fixed z-[60] flex flex-col items-end gap-2 pointer-events-auto md:hidden"
      style={{
        right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      {showQuests && <QuestDock />}
      <div className="flex gap-2">
        <DockButton
          active={showQuests}
          label="Quests"
          icon="⚑"
          title="Quests"
          onClick={onToggleQuests}
        />
        <DockButton
          active={showInitiative}
          label="Init"
          icon="⚔"
          title="Initiative tracker"
          onClick={onToggleInitiative}
        />
        <DockButton
          active={showDice}
          label="Dice"
          icon="🎲"
          title="Dice roller"
          onClick={onToggleDice}
        />
        <DockButton
          active={recapOpen}
          label="Recap"
          icon="📝"
          title="Session recap"
          onClick={() => toggleRecap()}
        />
        {onImportPc && (
          <DockButton
            active={false}
            label="My PC"
            icon="🧙"
            title="My character"
            onClick={onImportPc}
          />
        )}
        {inVoice ? (
          <>
            <DockButton
              active={!muted}
              label={muted ? 'Unmute' : 'Mute'}
              icon={muted ? '🔇' : '🎤'}
              title={muted ? 'Unmute' : 'Mute mic'}
              onClick={() => setVoiceMuted(!muted)}
            />
            <DockButton
              active={true}
              label="Hang up"
              icon="📵"
              title="Leave voice"
              onClick={() => leaveVoice()}
            />
          </>
        ) : (
          <DockButton
            active={false}
            label={joining ? '…' : 'Voice'}
            icon="🎙"
            title="Join table voice"
            onClick={() => void joinVoice()}
          />
        )}
        <MapViewModeToggle variant="dock" />
      </div>
    </div>
  );
}

function DockButton({
  active,
  label,
  icon,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex flex-col items-center justify-center rounded-lg shadow-panel min-w-[3.25rem] min-h-[3.25rem] px-2 py-1.5 transition-all"
      style={{
        background: active ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-secondary)',
        border: `1px solid ${active ? GOLD : BD}`,
        color: active ? GOLD : 'var(--color-text-primary)',
      }}
    >
      <span className="text-lg leading-none" aria-hidden>
        {icon}
      </span>
      <span className="font-ui text-[9px] font-semibold mt-0.5 tracking-wide">{label}</span>
    </button>
  );
}
