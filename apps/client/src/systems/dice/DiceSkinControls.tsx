import { useEffect, useState } from 'react';
import {
  buildCleanFaceCanvas,
  DEFAULT_DIE_COLORS,
  DIE_KINDS,
  fileToDiceSkinImage,
  useDiceSkinStore,
  type DieKind,
} from './diceSkinStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

/** Live preview of how an imported image maps onto a die face at the chosen fit. */
function SkinPreview({ image, fit }: { image: string; fit: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        const sheet = buildCleanFaceCanvas(img, fit, 128);
        setSrc(sheet ? sheet.canvas.toDataURL('image/png') : null);
      } catch {
        setSrc(null);
      }
    };
    img.onerror = () => {
      if (!cancelled) setSrc(null);
    };
    img.src = image;
    return () => {
      cancelled = true;
    };
  }, [image, fit]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt="Face preview"
      className="w-10 h-10 rounded shrink-0"
      style={{ border: `1px solid ${GOLD}` }}
      title="How the image fills one die face"
    />
  );
}

function AllDiceRow() {
  const setImageAll = useDiceSkinStore((s) => s.setImageAll);
  const setColorAll = useDiceSkinStore((s) => s.setColorAll);
  const imageFit = useDiceSkinStore((s) => s.imageFit);
  const setImageFit = useDiceSkinStore((s) => s.setImageFit);
  const previewImage = useDiceSkinStore((s) => {
    for (const kind of DIE_KINDS) {
      const img = s.skins[kind].image;
      if (img) return img;
    }
    return null;
  });
  const [error, setError] = useState('');

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      const dataUrl = await fileToDiceSkinImage(file);
      setImageAll(dataUrl);
    } catch {
      setError('Could not load that image.');
    }
  }

  return (
    <div className="rounded px-1.5 py-1.5" style={{ background: 'rgba(201,168,76,0.1)', border: `1px solid ${GOLD}` }}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-display text-[11px] shrink-0" style={{ color: GOLD }}>All 7 dice</span>
        <div className="flex-1" />
        <input
          type="color"
          defaultValue="#8b1a1a"
          onChange={(e) => setColorAll(e.target.value)}
          className="w-6 h-6 rounded cursor-pointer shrink-0 bg-transparent"
          style={{ border: `1px solid ${BD}`, padding: 0 }}
          title="Colour for all dice"
        />
        <label
          className="text-[10px] font-ui px-1.5 py-1 rounded cursor-pointer shrink-0"
          style={{ border: `1px solid ${GOLD}`, color: GOLD }}
          title="Import one image (e.g. a dice-set photo) for every die"
        >
          Set image (all)
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickImage(e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          onClick={() => setImageAll(null)}
          className="text-[10px] font-ui px-1.5 py-1 rounded shrink-0"
          style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
          title="Clear images on all dice"
        >
          Clear all
        </button>
      </div>
      {previewImage && (
        <div className="flex items-center gap-2 mt-1.5">
          <SkinPreview image={previewImage} fit={imageFit} />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
                Image fit (zoom)
              </span>
              <span className="font-ui text-[9px]" style={{ color: GOLD }}>
                {Math.round(imageFit * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.02}
              value={imageFit}
              onChange={(e) => setImageFit(Number(e.target.value))}
              className="w-full"
              title="Lower = zoom into a flat patch of the pattern; higher = show more of the die"
            />
          </div>
        </div>
      )}
      <p className="font-ui text-[9px] leading-tight mt-1" style={{ color: 'var(--color-text-secondary)' }}>
        Applies one image/colour to d4–d20 (and d100) at once. Use the fit slider to
        zoom into the pattern; the swatch shows one die face.
      </p>
      {error && (
        <p className="font-ui text-[10px] mt-0.5" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>
      )}
    </div>
  );
}

const SWATCHES = [
  '#8b1a1a', '#b91c1c', '#92400e', '#b45309', '#1a3a8b', '#2563eb',
  '#2d6a4f', '#15803d', '#6b21a8', '#7c3aed', '#374151', '#0f172a',
  '#0d9488', '#db2777', '#ca8a04', '#e5e7eb',
];

function DieSkinRow({ kind }: { kind: DieKind }) {
  const skin = useDiceSkinStore((s) => s.skins[kind]);
  const setColor = useDiceSkinStore((s) => s.setColor);
  const setImage = useDiceSkinStore((s) => s.setImage);
  const resetKind = useDiceSkinStore((s) => s.resetKind);
  const [error, setError] = useState('');

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      const dataUrl = await fileToDiceSkinImage(file);
      setImage(kind, dataUrl);
    } catch {
      setError('Could not load that image.');
    }
  }

  const isDefault = skin.color === DEFAULT_DIE_COLORS[kind] && !skin.image;

  return (
    <div className="rounded px-1.5 py-1" style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}>
      <div className="flex items-center gap-1.5">
        <span className="font-display text-xs w-7 shrink-0" style={{ color: GOLD }}>d{kind}</span>
        <input
          type="color"
          value={skin.color}
          onChange={(e) => setColor(kind, e.target.value)}
          className="w-6 h-6 rounded cursor-pointer shrink-0 bg-transparent"
          style={{ border: `1px solid ${BD}`, padding: 0 }}
          title={`d${kind} colour`}
        />
        <label
          className="text-[10px] font-ui px-1.5 py-1 rounded cursor-pointer shrink-0"
          style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
          title="Import an image for this die"
        >
          {skin.image ? 'Replace' : 'Image'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickImage(e.target.files?.[0])}
          />
        </label>
        {skin.image && (
          <img
            src={skin.image}
            alt={`d${kind} skin`}
            className="w-6 h-6 rounded object-cover shrink-0"
            style={{ border: `1px solid ${BD}` }}
          />
        )}
        <div className="flex-1" />
        {!isDefault && (
          <button
            type="button"
            onClick={() => resetKind(kind)}
            className="text-[10px] font-ui px-1.5 py-1 rounded shrink-0"
            style={{ color: 'var(--color-text-secondary)' }}
            title={`Reset d${kind}`}
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1 mt-1 pl-8">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(kind, c)}
            className="w-3.5 h-3.5 rounded-sm"
            style={{
              background: c,
              outline: skin.color.toLowerCase() === c.toLowerCase() ? `2px solid ${GOLD}` : 'none',
              outlineOffset: 1,
            }}
            title={c}
          />
        ))}
      </div>
      {error && (
        <p className="font-ui text-[10px] mt-0.5" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>
      )}
    </div>
  );
}

export function DiceSkinControls() {
  const [open, setOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const resetAll = useDiceSkinStore((s) => s.resetAll);
  const saveDiceSkinsNow = useDiceSkinStore((s) => s.saveDiceSkinsNow);
  const saveCurrentAsPreset = useDiceSkinStore((s) => s.saveCurrentAsPreset);
  const loadPreset = useDiceSkinStore((s) => s.loadPreset);
  const deletePreset = useDiceSkinStore((s) => s.deletePreset);
  const savedPresets = useDiceSkinStore((s) => s.savedPresets);

  function flash(msg: string) {
    setSaveMsg(msg);
    window.setTimeout(() => setSaveMsg(''), 2200);
  }

  function handleSaveNow() {
    flash(saveDiceSkinsNow() ? 'Dice skins saved on this device.' : 'Could not save — storage may be full.');
  }

  function handleSavePreset() {
    const preset = saveCurrentAsPreset(presetName);
    if (!preset) {
      flash('Enter a name for your dice set.');
      return;
    }
    setPresetName('');
    flash(`Saved preset "${preset.name}".`);
  }

  return (
    <div className="px-2 py-1.5 shrink-0" style={{ borderBottom: `1px solid ${BD}` }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between font-ui text-[11px]"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <span>🎨 Dice skins</span>
        <span style={{ color: GOLD }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          <div
            className="rounded px-1.5 py-1.5 space-y-1.5"
            style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
          >
            <div className="font-display text-[11px]" style={{ color: GOLD }}>Save dice set</div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <button
                type="button"
                onClick={handleSaveNow}
                className="text-[10px] font-ui px-2 py-1 rounded shrink-0"
                style={{ border: `1px solid ${GOLD}`, color: GOLD }}
              >
                Save skins
              </button>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name"
                className="input-dark text-[10px] py-0.5 flex-1 min-w-[5rem]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSavePreset();
                }}
              />
              <button
                type="button"
                onClick={handleSavePreset}
                className="text-[10px] font-ui px-2 py-1 rounded shrink-0"
                style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
              >
                Save preset
              </button>
            </div>
            {savedPresets.length > 0 && (
              <div className="space-y-0.5 max-h-24 overflow-y-auto">
                {savedPresets.map((preset) => (
                  <div key={preset.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        loadPreset(preset.id);
                        flash(`Loaded "${preset.name}".`);
                      }}
                      className="flex-1 text-left text-[10px] font-ui px-1.5 py-0.5 rounded truncate"
                      style={{ border: `1px solid ${BD}`, color: 'var(--color-text-primary)' }}
                      title={new Date(preset.savedAt).toLocaleString()}
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePreset(preset.id)}
                      className="text-[10px] px-1 py-0.5 shrink-0"
                      style={{ color: 'var(--color-accent-red-hot)' }}
                      title="Delete preset"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {saveMsg && (
              <p className="font-ui text-[9px]" style={{ color: GOLD }}>{saveMsg}</p>
            )}
          </div>
          <AllDiceRow />
          {DIE_KINDS.map((kind) => (
            <DieSkinRow key={kind} kind={kind} />
          ))}
          <p className="font-ui text-[9px] leading-tight" style={{ color: 'var(--color-text-secondary)' }}>
            d100 uses the d10 skin. Skins auto-save; use Save skins or a named preset to keep a set on this device.
          </p>
          <button
            type="button"
            onClick={resetAll}
            className="w-full text-[10px] font-ui py-1 rounded"
            style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
          >
            Reset all dice
          </button>
        </div>
      )}
    </div>
  );
}
