import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { RollMode } from '@grimoire/dice-engine';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useSessionStore } from '@/store/sessionStore';

export function RollOptionsMenu({
  anchor,
  notation,
  label,
  showAdvantage,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  notation: string;
  label: string;
  showAdvantage: boolean;
  onPick: (opts: { rollMode: RollMode; isSecret: boolean }) => void;
  onClose: () => void;
}) {
  const isGM = useSessionStore((s) => s.myRole) === 'GM';
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const menuWidth = 168;
  const left = Math.min(
    Math.max(8, anchor.left + anchor.width / 2 - menuWidth / 2),
    window.innerWidth - menuWidth - 8,
  );
  const top = Math.max(8, anchor.top - 8);

  const Option = ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-2.5 py-1.5 text-xs font-ui rounded transition-colors"
      style={{ color: 'var(--color-text-primary)' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {children}
    </button>
  );

  return createPortal(
    <div ref={ref}>
      <DraggablePanel
        title={label}
        subtitle={notation}
        onClose={onClose}
        defaultPosition={{ x: left, y: top }}
        width={menuWidth}
        maxHeight="320px"
        zIndex={200}
      >
        <div className="py-1" onContextMenu={(e) => e.preventDefault()}>
          <Option onClick={() => onPick({ rollMode: 'normal', isSecret: false })}>Roll</Option>
          {showAdvantage && (
            <>
              <Option onClick={() => onPick({ rollMode: 'advantage', isSecret: false })}>Advantage</Option>
              <Option onClick={() => onPick({ rollMode: 'disadvantage', isSecret: false })}>Disadvantage</Option>
            </>
          )}
          {isGM && (
            <>
              <div className="gold-divider mx-2 my-0.5" />
              <Option onClick={() => onPick({ rollMode: 'normal', isSecret: true })}>🔒 Secret roll</Option>
              {showAdvantage && (
                <>
                  <Option onClick={() => onPick({ rollMode: 'advantage', isSecret: true })}>🔒 Secret · Adv</Option>
                  <Option onClick={() => onPick({ rollMode: 'disadvantage', isSecret: true })}>🔒 Secret · Dis</Option>
                </>
              )}
            </>
          )}
        </div>
      </DraggablePanel>
    </div>,
    document.body,
  );
}
