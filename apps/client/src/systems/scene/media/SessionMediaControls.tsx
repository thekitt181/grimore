import { skipMusicTrack } from '../media/audioEngine';
import { useSceneMediaStore } from '../media/sceneMediaStore';

export function SessionMediaControls() {
  const scene = useSceneMediaStore((s) => s.activeScene);
  const masterVolume = useSceneMediaStore((s) => s.masterVolume);
  const ambientMuted = useSceneMediaStore((s) => s.ambientMuted);
  const musicMuted = useSceneMediaStore((s) => s.musicMuted);
  const setMasterVolume = useSceneMediaStore((s) => s.setMasterVolume);
  const setAmbientMuted = useSceneMediaStore((s) => s.setAmbientMuted);
  const setMusicMuted = useSceneMediaStore((s) => s.setMusicMuted);

  if (!scene) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-md text-xs font-ui"
      style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
    >
      <span style={{ color: 'var(--color-accent-gold)' }}>{scene.name}</span>
      <label className="flex items-center gap-1">
        Vol
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={masterVolume}
          onChange={(e) => setMasterVolume(Number(e.target.value))}
        />
      </label>
      <button type="button" className="btn-ghost text-xs py-0 px-2" onClick={() => setAmbientMuted(!ambientMuted)}>
        {ambientMuted ? 'Amb off' : 'Amb on'}
      </button>
      <button type="button" className="btn-ghost text-xs py-0 px-2" onClick={() => setMusicMuted(!musicMuted)}>
        {musicMuted ? 'Music off' : 'Music on'}
      </button>
      <button type="button" className="btn-ghost text-xs py-0 px-2" onClick={() => skipMusicTrack()}>
        Skip track
      </button>
    </div>
  );
}
