import { useEffect } from 'react';
import {
  bindVoiceSocket,
  joinVoice,
  leaveVoice,
  setVoiceDeafened,
  setVoiceMuted,
} from './voiceEngine';
import { useVoiceStore } from './voiceStore';

export function VoiceBar() {
  const joined = useVoiceStore((s) => s.joined);
  const joining = useVoiceStore((s) => s.joining);
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const error = useVoiceStore((s) => s.error);
  const selfSpeaking = useVoiceStore((s) => s.selfSpeaking);
  const peers = useVoiceStore((s) => s.peers);
  const peerList = Object.values(peers);

  useEffect(() => {
    bindVoiceSocket();
    return () => {
      if (useVoiceStore.getState().joined) leaveVoice();
    };
  }, []);

  return (
    <div
      className="flex items-center gap-1.5 rounded px-1.5 py-0.5 shrink-0 max-w-[min(100%,22rem)]"
      style={{
        background: 'var(--color-bg-tertiary)',
        border: `1px solid ${joined ? 'var(--color-accent-gold)' : 'var(--color-border)'}`,
      }}
      title="Table voice — same session, no Discord"
    >
      {!joined ? (
        <button
          type="button"
          className="btn-ghost text-[10px] py-0.5 px-2"
          disabled={joining}
          onClick={() => void joinVoice()}
        >
          {joining ? 'Joining…' : 'Join voice'}
        </button>
      ) : (
        <>
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: selfSpeaking ? '#4ade80' : muted ? '#f87171' : 'var(--color-accent-gold)' }}
            title={muted ? 'Muted' : selfSpeaking ? 'You are speaking' : 'In voice'}
          />
          <button
            type="button"
            className="btn-ghost text-[10px] py-0.5 px-1.5"
            onClick={() => setVoiceMuted(!muted)}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            className="btn-ghost text-[10px] py-0.5 px-1.5"
            onClick={() => setVoiceDeafened(!deafened)}
            title={deafened ? 'Hear table' : 'Deafen'}
          >
            {deafened ? 'Hear' : 'Deaf'}
          </button>
          <button
            type="button"
            className="btn-ghost text-[10px] py-0.5 px-1.5"
            onClick={() => leaveVoice()}
          >
            Leave
          </button>
        </>
      )}
      {peerList.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto max-w-[10rem] sm:max-w-[14rem]">
          {peerList.map((p) => (
            <span
              key={p.socketId}
              className="font-ui text-[10px] px-1 py-0.5 rounded shrink-0 truncate max-w-[5.5rem]"
              style={{
                color: p.speaking ? '#0a0a0f' : 'var(--color-text-secondary)',
                background: p.speaking ? 'var(--color-accent-gold)' : 'transparent',
                outline: p.failed ? '1px solid #f87171' : p.muted ? '1px dashed var(--color-border)' : undefined,
              }}
              title={`${p.username}${p.muted ? ' (muted)' : ''}${p.failed ? ' (can’t connect)' : ''}`}
            >
              {p.username}
            </span>
          ))}
        </div>
      )}
      {error && (
        <span className="font-ui text-[10px] truncate max-w-[8rem]" style={{ color: 'var(--color-accent-red-hot)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
