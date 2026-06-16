/** JB2A webms use black backdrops — screen blend removes the matte. */
export function styleJb2aVideo(
  video: HTMLVideoElement,
  extra?: Partial<CSSStyleDeclaration>,
): void {
  Object.assign(video.style, {
    position: 'fixed',
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    objectFit: 'contain',
    mixBlendMode: 'screen',
    ...extra,
  });
}

export function bindJb2aVideoCleanup(
  video: HTMLVideoElement,
  remove: () => void,
  durationMs: number,
  onFail?: () => void,
): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    remove();
  };
  const fail = () => {
    if (done) return;
    done = true;
    remove();
    onFail?.();
  };

  video.addEventListener('ended', finish, { once: true });
  video.addEventListener('error', fail, { once: true });
  window.setTimeout(finish, durationMs + 300);
  void video.play().catch(fail);
}
