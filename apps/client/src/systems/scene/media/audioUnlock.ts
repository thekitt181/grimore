import { Howler } from 'howler';

let installed = false;

export function isAudioContextSuspended(): boolean {
  return Howler.ctx?.state === 'suspended';
}

/** Resume Web Audio after a user gesture (required on iOS / mobile). */
export function resumeAudioContext(): Promise<void> {
  const ctx = Howler.ctx;
  if (!ctx || ctx.state !== 'suspended') return Promise.resolve();
  return ctx.resume().catch(() => undefined);
}

/** One-time listeners so the first tap anywhere can unlock audio. */
export function installAudioUnlock(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const unlock = () => {
    void resumeAudioContext();
  };
  document.addEventListener('touchstart', unlock, { passive: true, once: true });
  document.addEventListener('click', unlock, { once: true });
}
