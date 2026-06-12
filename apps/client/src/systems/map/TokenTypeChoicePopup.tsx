interface Props {
  x: number;
  y: number;
  onSelect: (type: '2d' | '3d') => void;
  onDismiss: () => void;
}

/** Mini popup after category wheel: place token as flat 2D or 3D miniature. */
export function TokenTypeChoicePopup({ x, y, onSelect, onDismiss }: Props) {
  return (
    <div
      className="fixed inset-0 z-[70]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        className="absolute rounded-lg shadow-panel px-4 py-3 flex flex-col gap-2"
        style={{
          left: x,
          top: y,
          transform: 'translate(-50%, -50%)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-gold)',
          minWidth: 200,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="font-display text-xs tracking-wider uppercase text-center" style={{ color: 'var(--color-accent-gold)' }}>
          Token type
        </p>
        <button
          type="button"
          className="btn-primary text-sm py-2"
          onClick={() => onSelect('2d')}
        >
          Place as 2D Token
        </button>
        <button
          type="button"
          className="btn-ghost text-sm py-2 border border-[var(--color-border-gold)]"
          onClick={() => onSelect('3d')}
        >
          Place as 3D Token
        </button>
      </div>
    </div>
  );
}
