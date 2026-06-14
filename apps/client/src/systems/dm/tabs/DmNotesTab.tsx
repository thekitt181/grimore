import { useEffect, useState } from 'react';
import { loadDmNotes, saveDmNotes } from '../dmScreenStore';

export function DmNotesTab({ sessionId }: { sessionId: string }) {
  const [notes, setNotes] = useState(() => loadDmNotes(sessionId));

  useEffect(() => {
    setNotes(loadDmNotes(sessionId));
  }, [sessionId]);

  useEffect(() => {
    const timer = setTimeout(() => saveDmNotes(sessionId, notes), 400);
    return () => clearTimeout(timer);
  }, [sessionId, notes]);

  return (
    <div className="space-y-2 h-full flex flex-col min-h-0">
      <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
        Private GM notes — saved in this browser only (not shared with players).
      </p>
      <textarea
        className="input-dark w-full flex-1 min-h-[200px] text-xs py-2 px-2 resize-y font-ui leading-relaxed"
        placeholder="Session prep, NPC secrets, plot hooks…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
    </div>
  );
}
