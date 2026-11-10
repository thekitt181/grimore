import { useState, type CSSProperties } from 'react';

/** Number field that only commits on blur/Enter so typing 21 does not flash 2 then 0. */
export function HpCommitInput({
  value,
  min = 0,
  max,
  className,
  style,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  className?: string;
  style?: CSSProperties;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  function commit() {
    const n = parseInt(draft ?? String(value), 10);
    setDraft(null);
    if (!Number.isFinite(n)) return;
    let next = Math.max(min, n);
    if (max != null) next = Math.min(max, next);
    if (next !== value) onCommit(next);
  }

  return (
    <input
      type="number"
      className={className}
      style={style}
      min={min}
      max={max}
      value={shown}
      onFocus={() => setDraft(String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
