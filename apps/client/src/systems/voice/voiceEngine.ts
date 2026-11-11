import type { VoiceIceServer, VoicePeerInfo, VoiceSignalData } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useVoiceStore } from './voiceStore';
import { startVoiceScribe, stopVoiceScribe } from './voiceScribe';

const SPEAK_RMS = 0.045;
const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface PeerLink {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  source: MediaStreamAudioSourceNode | null;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

let localStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let localAnalyser: AnalyserNode | null = null;
let localSource: MediaStreamAudioSourceNode | null = null;
let iceServers: RTCIceServer[] = DEFAULT_ICE;
let mySocketId: string | null = null;
let sessionId: string | null = null;
let wantJoined = false;
let speakTimer: number | null = null;
let lastEmittedSpeaking = false;
let speakHoldUntil = 0;
const peers = new Map<string, PeerLink>();
let bound = false;

function store() {
  return useVoiceStore.getState();
}

function toRtcIce(list: VoiceIceServer[] | undefined): RTCIceServer[] {
  if (!list || list.length === 0) return DEFAULT_ICE;
  return list.map((s) => {
    const ice: RTCIceServer = { urls: s.urls };
    if (s.username) ice.username = s.username;
    if (s.credential) ice.credential = s.credential;
    return ice;
  });
}

function ensureAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function rmsFromAnalyser(analyser: AnalyserNode): number {
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = (buf[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

function emitLocalSpeaking(speaking: boolean): void {
  if (speaking === lastEmittedSpeaking) return;
  lastEmittedSpeaking = speaking;
  const sid = sessionId ?? useSessionStore.getState().sessionId;
  const myId = useSessionStore.getState().myUserId;
  if (myId) store().setUserSpeaking(myId, speaking);
  if (!sid || !getSocket().connected || !wantJoined) return;
  getSocket().emit('voice:speaking', { sessionId: sid, speaking });
}

function tickSpeaking(): void {
  const deafened = store().deafened;
  const muted = store().muted;
  const loud = Boolean(localAnalyser && !muted && rmsFromAnalyser(localAnalyser) > SPEAK_RMS);
  const now = Date.now();
  if (loud) speakHoldUntil = now + 220;
  const speaking = now < speakHoldUntil;
  store().setSelfSpeaking(speaking);
  emitLocalSpeaking(speaking);
  for (const [id, link] of peers) {
    if (deafened || !link.analyser) {
      store().patchPeer(id, { speaking: false });
      continue;
    }
    store().patchPeer(id, { speaking: rmsFromAnalyser(link.analyser) > SPEAK_RMS });
  }
}

function startSpeakLoop(): void {
  stopSpeakLoop();
  speakTimer = window.setInterval(tickSpeaking, 80);
}

function stopSpeakLoop(): void {
  if (speakTimer != null) {
    window.clearInterval(speakTimer);
    speakTimer = null;
  }
}

function attachRemoteAnalyser(link: PeerLink, stream: MediaStream): void {
  const ctx = ensureAudioCtx();
  if (!ctx || stream.getAudioTracks().length === 0) return;
  try {
    link.source?.disconnect();
    link.source = ctx.createMediaStreamSource(stream);
    link.analyser = ctx.createAnalyser();
    link.analyser.fftSize = 512;
    link.source.connect(link.analyser);
  } catch {
    link.analyser = null;
  }
}

function attachLocalAnalyser(): void {
  const ctx = ensureAudioCtx();
  if (!ctx || !localStream || localStream.getAudioTracks().length === 0) return;
  try {
    localSource?.disconnect();
    localSource = ctx.createMediaStreamSource(localStream);
    localAnalyser = ctx.createAnalyser();
    localAnalyser.fftSize = 512;
    localSource.connect(localAnalyser);
  } catch {
    localAnalyser = null;
  }
}

function sendSignal(toSocketId: string, data: VoiceSignalData): void {
  const sid = sessionId ?? useSessionStore.getState().sessionId;
  if (!sid || !getSocket().connected) return;
  getSocket().emit('voice:signal', { sessionId: sid, toSocketId, data });
}

function polite(remoteId: string): boolean {
  return (mySocketId ?? '') < remoteId;
}

function closePeer(remoteId: string): void {
  const link = peers.get(remoteId);
  if (!link) return;
  peers.delete(remoteId);
  try {
    link.source?.disconnect();
  } catch { /* ignore */ }
  link.pc.close();
  link.audio.srcObject = null;
  link.audio.remove();
  store().removePeer(remoteId);
}

function wirePeer(remoteId: string, info: VoicePeerInfo): PeerLink {
  const existing = peers.get(remoteId);
  if (existing) {
    store().patchPeer(remoteId, {
      userId: info.userId || store().peers[remoteId]?.userId || '',
      username: info.username || store().peers[remoteId]?.username || 'Player',
      muted: info.muted,
    });
    return existing;
  }

  const pc = new RTCPeerConnection({ iceServers });
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.setAttribute('playsinline', 'true');
  audio.style.display = 'none';
  audio.muted = store().deafened;
  document.body.appendChild(audio);

  const link: PeerLink = {
    pc,
    audio,
    analyser: null,
    source: null,
    makingOffer: false,
    ignoreOffer: false,
  };
  peers.set(remoteId, link);

  if (localStream) {
    for (const track of localStream.getAudioTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    sendSignal(remoteId, {
      kind: 'ice',
      candidate: ev.candidate.candidate,
      sdpMid: ev.candidate.sdpMid ?? null,
      sdpMLineIndex: ev.candidate.sdpMLineIndex ?? null,
    });
  };

  pc.ontrack = (ev) => {
    const stream = ev.streams[0] ?? new MediaStream([ev.track]);
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    attachRemoteAnalyser(link, stream);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      store().patchPeer(remoteId, { failed: true });
      try {
        pc.restartIce();
      } catch { /* ignore */ }
    } else if (pc.connectionState === 'connected') {
      store().patchPeer(remoteId, { failed: false });
    } else if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
      if (pc.connectionState === 'closed') closePeer(remoteId);
    }
  };

  pc.onnegotiationneeded = () => {
    void (async () => {
      try {
        link.makingOffer = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdp = pc.localDescription?.sdp;
        if (sdp) sendSignal(remoteId, { kind: 'offer', sdp });
      } catch (err) {
        console.warn('[Voice] offer failed', err);
      } finally {
        link.makingOffer = false;
      }
    })();
  };

  store().upsertPeer({
    socketId: info.socketId,
    userId: info.userId,
    username: info.username,
    muted: info.muted,
    speaking: false,
    failed: false,
  });

  return link;
}

async function handleSignal(fromSocketId: string, data: VoiceSignalData): Promise<void> {
  let link = peers.get(fromSocketId);
  if (!link) {
    link = wirePeer(fromSocketId, {
      socketId: fromSocketId,
      userId: '',
      username: 'Player',
      muted: false,
    });
  }
  const pc = link.pc;

  if (data.kind === 'ice') {
    try {
      await pc.addIceCandidate({
        candidate: data.candidate,
        sdpMid: data.sdpMid,
        sdpMLineIndex: data.sdpMLineIndex,
      });
    } catch (err) {
      if (!link.ignoreOffer) console.warn('[Voice] ICE', err);
    }
    return;
  }

  if (data.kind === 'offer') {
    const collision = link.makingOffer || pc.signalingState !== 'stable';
    link.ignoreOffer = !polite(fromSocketId) && collision;
    if (link.ignoreOffer) return;
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const sdp = pc.localDescription?.sdp;
      if (sdp) sendSignal(fromSocketId, { kind: 'answer', sdp });
    } catch (err) {
      console.warn('[Voice] answer failed', err);
    }
    return;
  }

  try {
    await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
  } catch (err) {
    console.warn('[Voice] remote answer failed', err);
  }
}

function applyMuteToTrack(): void {
  const muted = store().muted;
  if (!localStream) return;
  for (const track of localStream.getAudioTracks()) {
    track.enabled = !muted;
  }
}

function applyDeafen(): void {
  const deafened = store().deafened;
  for (const link of peers.values()) {
    link.audio.muted = deafened;
  }
}

function teardownMedia(): void {
  stopVoiceScribe();
  stopSpeakLoop();
  speakHoldUntil = 0;
  emitLocalSpeaking(false);
  for (const id of [...peers.keys()]) closePeer(id);
  localSource?.disconnect();
  localSource = null;
  localAnalyser = null;
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  mySocketId = null;
  store().reset();
}

export async function joinVoice(): Promise<void> {
  const sid = useSessionStore.getState().sessionId;
  if (!sid) {
    store().setError('No session');
    return;
  }
  if (!getSocket().connected) {
    store().setError('Not connected');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    store().setError('Voice needs a browser with microphone support');
    return;
  }
  store().setJoining(true);
  store().setError(null);
  try {
    ensureAudioCtx();
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    attachLocalAnalyser();
    applyMuteToTrack();
    sessionId = sid;
    wantJoined = true;
    startSpeakLoop();
    getSocket().emit('voice:join', { sessionId: sid });
    store().setJoined(true);
    startVoiceScribe();
  } catch (err) {
    wantJoined = false;
    teardownMedia();
    const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
    store().setError(denied ? 'Microphone blocked' : 'Could not open microphone');
    store().setJoining(false);
  }
}

export function leaveVoice(): void {
  speakHoldUntil = 0;
  store().setSelfSpeaking(false);
  emitLocalSpeaking(false);
  wantJoined = false;
  const sid = sessionId ?? useSessionStore.getState().sessionId;
  if (sid && getSocket().connected) {
    getSocket().emit('voice:leave', { sessionId: sid });
  }
  sessionId = null;
  teardownMedia();
}

export function setVoiceMuted(muted: boolean): void {
  store().setMuted(muted);
  applyMuteToTrack();
  const sid = sessionId ?? useSessionStore.getState().sessionId;
  if (sid && wantJoined && getSocket().connected) {
    getSocket().emit('voice:mute', { sessionId: sid, muted });
  }
  if (muted) {
    speakHoldUntil = 0;
    store().setSelfSpeaking(false);
    emitLocalSpeaking(false);
  }
}

export function setVoiceDeafened(deafened: boolean): void {
  store().setDeafened(deafened);
  applyDeafen();
}

export function rejoinVoiceAfterSocketUp(): void {
  if (!wantJoined) return;
  const sid = useSessionStore.getState().sessionId;
  if (!sid || !getSocket().connected || !localStream) return;
  sessionId = sid;
  for (const id of [...peers.keys()]) closePeer(id);
  getSocket().emit('voice:join', { sessionId: sid });
  startVoiceScribe();
}

export function bindVoiceSocket(): void {
  const socket = getSocket();
  if (bound) return;
  bound = true;

  socket.on('voice:peers', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid) return;
    iceServers = toRtcIce(payload.iceServers);
    mySocketId = payload.selfSocketId;
    store().setSelfSocketId(payload.selfSocketId);
    for (const peer of payload.peers) {
      wirePeer(peer.socketId, peer);
    }
  });

  socket.on('voice:peer-joined', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid || !wantJoined) return;
    if (payload.peer.socketId === mySocketId) return;
    wirePeer(payload.peer.socketId, payload.peer);
  });

  socket.on('voice:peer-left', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid) return;
    closePeer(payload.socketId);
  });

  socket.on('voice:signal', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid) return;
    void handleSignal(payload.fromSocketId, payload.data);
  });

  socket.on('voice:mute', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid) return;
    if (payload.socketId === mySocketId) {
      store().setMuted(payload.muted);
      applyMuteToTrack();
      return;
    }
    store().patchPeer(payload.socketId, { muted: payload.muted });
  });

  socket.on('voice:speaking', (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId !== sid) return;
    store().setUserSpeaking(payload.userId, payload.speaking);
  });
}
