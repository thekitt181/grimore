import { useCallback, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export interface DraggablePanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  defaultPosition?: { x: number; y: number };
  width?: number;
  maxHeight?: string;
  zIndex?: number;
  className?: string;
}

export function DraggablePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
  defaultPosition,
  width = 320,
  maxHeight = 'calc(100vh - 100px)',
  zIndex = 160,
  className = '',
}: DraggablePanelProps) {
  const [pos, setPos] = useState(() => {
    if (defaultPosition) return defaultPosition;
    if (typeof window !== 'undefined') {
      return { x: Math.max(16, window.innerWidth - width - 24), y: 80 };
    }
    return { x: 16, y: 80 };
  });
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onHeaderPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pos.x, pos.y]);

  const onHeaderPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 120, dragRef.current.origX + dx)),
      y: Math.max(0, dragRef.current.origY + dy),
    });
  }, []);

  const onHeaderPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div
      className={`fixed flex flex-col rounded-lg shadow-2xl overflow-hidden pointer-events-auto ${className}`}
      style={{
        left: pos.x,
        top: pos.y,
        width,
        maxHeight: minimized ? undefined : maxHeight,
        zIndex,
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${BD}`,
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
        style={{ borderBottom: minimized ? undefined : `1px solid ${BD}` }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm truncate" style={{ color: GOLD }}>{title}</div>
          {subtitle && (
            <div className="font-ui text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="text-xs opacity-50 hover:opacity-100 w-5 h-5 flex items-center justify-center"
            title={minimized ? 'Restore' : 'Minimize'}
            onClick={() => setMinimized((v) => !v)}
          >
            {minimized ? '▢' : '−'}
          </button>
          {onClose && (
            <button
              type="button"
              className="text-xs opacity-50 hover:opacity-100 w-5 h-5 flex items-center justify-center"
              title="Close"
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {!minimized && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
          {footer && (
            <div className="shrink-0 px-3 py-2 border-t text-[9px] opacity-50" style={{ borderColor: BD }}>
              {footer}
            </div>
          )}
        </>
      )}
    </div>
  );
}
