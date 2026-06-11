import { useEffect, useRef, useState } from 'react';
import { registerTextSetter, commitTextDrawing, type PendingText } from './hooks/useDrawingTool';
import { useMapStore } from './store/mapStore';
import { DEFAULT_TEXT_FONT_SIZE } from './drawColors';

/**
 * Inline text input for DM and players when the text drawing tool is active.
 */
export function DrawingTextInput() {
  const [pending, setPending] = useState<PendingText | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const textFontSize = useMapStore((s) => s.textFontSize);
  const drawColor = useMapStore((s) => s.drawColor);

  useEffect(() => {
    registerTextSetter((p) => {
      setPending(p);
      setValue('');
    });
    return () => registerTextSetter(() => {});
  }, []);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') {
      setPending(null);
      setValue('');
    }
  }

  if (!pending) return null;

  const fontSize = textFontSize || DEFAULT_TEXT_FONT_SIZE;

  return (
    <div
      className="absolute z-50 pointer-events-auto"
      style={{ left: pending.screenX, top: pending.screenY, transform: 'translate(-2px, -8px)' }}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        rows={Math.min(4, Math.max(1, value.split('\n').length))}
        placeholder="Type label… Enter to place, Shift+Enter for new line"
        className="font-ui px-2 py-1 rounded shadow-lg outline-none resize-none"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-accent-gold)',
          color: drawColor,
          fontSize,
          minWidth: 200,
          maxWidth: 320,
        }}
      />
    </div>
  );
}
