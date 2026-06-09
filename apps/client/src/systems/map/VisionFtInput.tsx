import { useEffect, useState } from 'react';

function digitsOnly(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}

/** Feet input that allows free typing (e.g. clear "1" from "130" → "30"); commits on blur. */
export function VisionFtInput({
  valueFt,
  onChangeFt,
}: {
  valueFt: number;
  onChangeFt: (ft: number) => void;
}) {
  const [draft, setDraft] = useState(String(valueFt));

  useEffect(() => {
    setDraft(String(valueFt));
  }, [valueFt]);

  function commit() {
    if (draft === '') {
      setDraft(String(valueFt));
      return;
    }
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && n >= 1) {
      onChangeFt(n);
      setDraft(String(n));
    } else {
      setDraft(String(valueFt));
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      className="input-stat"
      value={draft}
      onChange={(e) => setDraft(digitsOnly(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

/** Draft string input for forms — parent reads draft when submitting. */
export function VisionFtDraftInput({
  draft,
  onDraftChange,
}: {
  draft: string;
  onDraftChange: (draft: string) => void;
}) {
  function normalize() {
    if (draft === '') {
      onDraftChange('1');
      return;
    }
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && n >= 1) onDraftChange(String(n));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      className="input-stat"
      value={draft}
      onChange={(e) => onDraftChange(digitsOnly(e.target.value))}
      onBlur={normalize}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

export function parseVisionFt(draft: string, fallback: number): number {
  const n = parseInt(draft, 10);
  return !Number.isNaN(n) && n >= 1 ? n : fallback;
}
