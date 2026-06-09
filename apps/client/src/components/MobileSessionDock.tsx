const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export function MobileSessionDock({
  showInitiative,
  showDice,
  onToggleInitiative,
  onToggleDice,
}: {
  showInitiative: boolean;
  showDice: boolean;
  onToggleInitiative: () => void;
  onToggleDice: () => void;
}) {
  return (
    <div
      className="fixed z-[60] flex gap-2 pointer-events-auto md:hidden"
      style={{
        right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
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
