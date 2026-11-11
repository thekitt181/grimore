import { buildSessionRecap, cleanRecapUtterance } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { useSessionRecapStore } from './sessionRecapStore';

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechCtor = new () => BrowserSpeechRecognition;

let rec: BrowserSpeechRecognition | null = null;
let wantOn = false;
let restartTimer: number | null = null;

function speechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function partyNames(): string[] {
  return Object.values(useItemStore.getState().items)
    .filter((i): i is TokenItem => i.type === 'token' && Boolean(i.isPc || i.ownerId?.trim()))
    .map((i) => i.name)
    .filter(Boolean);
}

function emitUtterance(text: string): void {
  const sessionId = useSessionStore.getState().sessionId;
  const cleaned = cleanRecapUtterance(text, partyNames());
  if (!sessionId || !cleaned || !getSocket().connected) return;
  getSocket().emit('voice:transcript', { sessionId, text: cleaned });
}

export function speechScribeAvailable(): boolean {
  return speechCtor() != null;
}

export function startVoiceScribe(): void {
  const Ctor = speechCtor();
  if (!Ctor) {
    useSessionRecapStore.getState().setScribeError('Live notes need Chrome or Edge (speech capture).');
    useSessionRecapStore.getState().setScribeOn(false);
    return;
  }
  wantOn = true;
  if (rec) return;
  const r = new Ctor();
  rec = r;
  r.continuous = true;
  r.interimResults = true;
  r.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
  r.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const result = ev.results[i];
      if (!result || !result.isFinal) continue;
      emitUtterance(result[0]?.transcript ?? '');
    }
  };
  r.onerror = (ev) => {
    if (ev.error === 'no-speech' || ev.error === 'aborted') return;
    if (ev.error === 'not-allowed') {
      useSessionRecapStore.getState().setScribeError('Speech capture blocked — allow the microphone.');
      wantOn = false;
      useSessionRecapStore.getState().setScribeOn(false);
    }
  };
  r.onend = () => {
    rec = null;
    if (!wantOn) {
      useSessionRecapStore.getState().setScribeOn(false);
      return;
    }
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      if (wantOn) startVoiceScribe();
    }, 250);
  };
  try {
    r.start();
    useSessionRecapStore.getState().setScribeOn(true);
    useSessionRecapStore.getState().setScribeError(null);
  } catch {
    rec = null;
    useSessionRecapStore.getState().setScribeError('Could not start speech notes.');
    useSessionRecapStore.getState().setScribeOn(false);
  }
}

export function stopVoiceScribe(): void {
  wantOn = false;
  if (restartTimer != null) {
    window.clearTimeout(restartTimer);
    restartTimer = null;
  }
  try {
    rec?.stop();
  } catch { /* ignore */ }
  rec = null;
  useSessionRecapStore.getState().setScribeOn(false);
}

export function bindRecapSocket(): void {
  const socket = getSocket();
  socket.off('voice:transcript');
  socket.off('recap:sync');
  socket.on('voice:transcript', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid) return;
    useSessionRecapStore.getState().addLine(payload.line);
  });
  socket.on('recap:sync', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid) return;
    useSessionRecapStore.getState().applySync(
      buildSessionRecap(payload.lines, {
        published: payload.recap.published,
        partyNames: partyNames(),
      }),
      payload.lines,
    );
  });
}

export function requestSessionRecap(): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || !getSocket().connected) return;
  getSocket().emit('recap:request', { sessionId });
}

export function publishSessionRecap(published: boolean): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || !getSocket().connected) return;
  getSocket().emit('recap:publish', { sessionId, published });
}

export function clearSessionRecap(): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || !getSocket().connected) return;
  getSocket().emit('recap:clear', { sessionId });
}
