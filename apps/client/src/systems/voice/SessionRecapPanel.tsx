import { DraggablePanel } from '@/components/DraggablePanel';
import { useSessionStore } from '@/store/sessionStore';
import { saveDmNotes, loadDmNotes } from '@/systems/dm/dmScreenStore';
import { ddbPanelPosition, ddbPanelWidth } from '@/systems/ddb/ddbTokenUtils';
import { isMobileClient } from '@/lib/socket';
import { useSessionRecapStore } from './sessionRecapStore';
import {
  clearSessionRecap,
  publishSessionRecap,
  speechScribeAvailable,
} from './voiceScribe';
import { useVoiceStore } from './voiceStore';

export function SessionRecapBody() {
  const isGM = useSessionStore((s) => s.myRole) === 'GM';
  const sessionId = useSessionStore((s) => s.sessionId);
  const recap = useSessionRecapStore((s) => s.recap);
  const lines = useSessionRecapStore((s) => s.lines);
  const scribeOn = useSessionRecapStore((s) => s.scribeOn);
  const scribeError = useSessionRecapStore((s) => s.scribeError);
  const inVoice = useVoiceStore((s) => s.joined);

  function copyToGmNotes() {
    if (!sessionId) return;
    const blocks = [
      `## Session recap (${new Date(recap.updatedAt || Date.now()).toLocaleString()})`,
      recap.summary,
      ...recap.sections.map((sec) => `### ${sec.title}\n${sec.bullets.map((b) => `- ${b}`).join('\n')}`),
    ].filter(Boolean);
    const prev = loadDmNotes(sessionId).trim();
    saveDmNotes(sessionId, [prev, blocks.join('\n\n')].filter(Boolean).join('\n\n'));
  }

  const footer = inVoice
    ? scribeOn
      ? 'Listening to the table…'
      : scribeError ?? 'Join voice — notes capture as you speak'
    : 'Join voice so the scribe can hear the table';

  return (
      <div className="flex flex-col gap-3 text-xs font-ui min-h-0">
        <div className="flex flex-wrap gap-1">
          {isGM && (
            <>
              <button
                type="button"
                className="btn-ghost text-[10px] py-0.5 px-2"
                onClick={() => publishSessionRecap(!recap.published)}
              >
                {recap.published ? 'Unpin recap' : 'Pin recap'}
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] py-0.5 px-2"
                onClick={() => copyToGmNotes()}
              >
                Copy to GM notes
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] py-0.5 px-2"
                onClick={() => {
                  if (window.confirm('Clear this session’s voice notes and recap?')) clearSessionRecap();
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>

        {!speechScribeAvailable() && (
          <p style={{ color: 'var(--color-accent-red-hot)' }}>
            Chrome or Edge is needed to turn your mic into notes. Others’ speech still appears if they use those browsers.
          </p>
        )}
        {scribeError && <p style={{ color: 'var(--color-accent-red-hot)' }}>{scribeError}</p>}

        <section>
          <h3 className="font-display text-sm tracking-wide mb-1" style={{ color: 'var(--color-accent-gold)' }}>
            Summary
          </h3>
          <p className="leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
            {recap.summary || 'Nothing captured yet.'}
          </p>
          {recap.published && (
            <p className="mt-1 text-[10px]" style={{ color: 'var(--color-accent-gold)' }}>
              Pinned as the official recap
            </p>
          )}
        </section>

        {recap.sections.map((sec) => (
          <section key={sec.id}>
            <h3 className="font-display text-[11px] tracking-wide mb-1" style={{ color: 'var(--color-accent-gold)' }}>
              {sec.title}
            </h3>
            <ul className="space-y-1 pl-3 list-disc" style={{ color: 'var(--color-text-secondary)' }}>
              {sec.bullets.map((b) => (
                <li key={b} className="leading-snug">{b}</li>
              ))}
            </ul>
          </section>
        ))}

        <section>
          <h3 className="font-display text-[11px] tracking-wide mb-1" style={{ color: 'var(--color-accent-gold)' }}>
            Live transcript ({lines.length})
          </h3>
          <div
            className="max-h-40 overflow-y-auto rounded px-2 py-1.5 space-y-1"
            style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
          >
            {lines.length === 0 && (
              <p style={{ color: 'var(--color-text-secondary)' }}>
                Speak in-game after Join voice — including RP with PCs and NPCs. Side talk, food, tech, and “brb” are dropped.
              </p>
            )}
            {lines.slice(-80).map((line) => (
              <p key={line.id} className="leading-snug">
                <span style={{ color: 'var(--color-accent-gold)' }}>{line.username}: </span>
                <span style={{ color: 'var(--color-text-primary)' }}>{line.text}</span>
              </p>
            ))}
          </div>
        </section>
        <p className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{footer}</p>
      </div>
  );
}

export function SessionRecapPanel({ onClose }: { onClose: () => void }) {
  return (
    <DraggablePanel
      title="Session recap"
      subtitle="Voice notes · table chronicle"
      onClose={onClose}
      defaultPosition={
        isMobileClient()
          ? ddbPanelPosition(8, 48)
          : { x: 24, y: 72 }
      }
      width={ddbPanelWidth(400)}
      maxHeight="calc(100vh - 80px)"
      zIndex={146}
    >
      <SessionRecapBody />
    </DraggablePanel>
  );
}
