import { useEffect, useRef, useState } from 'react';
import { registerTextSetter, commitTextDrawing, type PendingText } from './hooks/useDrawingTool';

/**
 * Inline text input that appears at the clicked screen position
 * when the 'text' drawing tool is active.
 */
export function DrawingTextInput() {
  const [pending, setPending] = useState<PendingText | null>(null);
  const [value, setValue]     = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Register setter so the drawing tool hook can trigger this overlay
  useEffect(() => {
    registerTextSetter((p) => {
      setPending(p);
      setValue('');
    });
    return () => registerTextSetter(() => {});
  }, []);

  // Auto-focus when it appears
  useEffect(() => {
    if (pending) setTimeout(() => inputRef.current?.focus(), 0);
  }, [pending]);

  function commit() {
    if (!pending) return;
    const trimmed = value.trim();
    if (trimmed) commitTextDrawing(pending.worldX, pending.worldY, trimmed);
    setPending(null);
    setValue('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setPending(null); setValue(''); }
  }

  if (!pending) return null;

  return (
    <div
      className="absolute z-50 pointer-events-auto"
      style={{ left: pending.screenX, top: pending.screenY, transform: 'translate(-2px, -50%)' }}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder="Type text, Enter to place…"
        className="font-ui text-sm px-2 py-1 rounded shadow-lg outline-none"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-accent-gold)',
          color: 'var(--color-text-primary)',
          minWidth: 180,
        }}
      />
    </div>
  );
}
