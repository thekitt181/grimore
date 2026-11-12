import { buildSessionRecap, cleanRecapUtterance, type RecapLine } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { useSessionRecapStore } from './sessionRecapStore';
import { tryVoiceMapFx } from './voiceMapFx';

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

function partyTokens(): TokenItem[] {
  return Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token',
  );
}

function partyNames(): string[] {
  return partyTokens()
    .filter((i) => Boolean(i.isPc || i.ownerId?.trim()))
    .map((i) => i.name)
    .filter(Boolean);
}

/** Token name for the user assigned as that character. */
export function assignedCharacterName(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const owned = partyTokens().filter((t) => t.ownerId?.trim() === userId && t.name.trim());
  if (owned.length === 0) return null;
  const preferred = owned.find((t) => t.ddbCharacterId) ?? owned.find((t) => t.isPc) ?? owned[0];
  return preferred?.name.trim() ?? null;
}

function labelLinesForScript(lines: RecapLine[]) {
  return lines.map((line) => {
    const character = assignedCharacterName(line.userId);
    if (!character || character === line.username) return line;
    return { ...line, username: character };
  });
}

function emitUtterance(text: string): void {
  const sessionId = useSessionStore.getState().sessionId;
  const myUserId = useSessionStore.getState().myUserId;
  const names = partyNames();
  const cleaned = cleanRecapUtterance(text, names);
  if (!sessionId || !cleaned || !getSocket().connected) return;
  const characterName = assignedCharacterName(myUserId);
  getSocket().emit('voice:transcript', {
    sessionId,
    text: cleaned,
    ...(characterName ? { characterName } : {}),
  });
  tryVoiceMapFx(cleaned);
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
    const [line] = labelLinesForScript([payload.line]);
    if (line) useSessionRecapStore.getState().addLine(line);
  });
  socket.on('recap:sync', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid) return;
    const lines = labelLinesForScript(payload.lines);
    useSessionRecapStore.getState().applySync(
      buildSessionRecap(lines, {
        published: payload.recap.published,
        partyNames: partyNames(),
      }),
      lines,
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
