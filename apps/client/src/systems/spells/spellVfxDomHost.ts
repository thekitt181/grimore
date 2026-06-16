const ROOT_ID = 'grimoire-spell-vfx-root';

export type SpellVfxDomLayer = 'zone' | 'cast' | 'rings';

let root: HTMLDivElement | null = null;
const layers = new Map<SpellVfxDomLayer, HTMLDivElement>();

function ensureRoot(): HTMLDivElement {
  if (root && document.body.contains(root)) return root;

  root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:10000',
      'overflow:visible',
    ].join(';');
    document.body.appendChild(root);

    for (const name of ['zone', 'cast', 'rings'] as const) {
      const layer = document.createElement('div');
      layer.dataset.spellVfxLayer = name;
      layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible';
      root.appendChild(layer);
      layers.set(name, layer);
    }
  }

  return root;
}

export function getSpellVfxDomLayer(name: SpellVfxDomLayer): HTMLDivElement {
  ensureRoot();
  const layer = layers.get(name);
  if (!layer) throw new Error(`Missing spell VFX layer: ${name}`);
  return layer;
}

export function showSpellVfxDomRoot(): void {
  const el = ensureRoot();
  el.style.display = 'block';
}

export function hideSpellVfxDomRoot(): void {
  if (!root) return;
  root.style.display = 'none';
  for (const layer of layers.values()) {
    layer.innerHTML = '';
  }
}

export function clearSpellVfxDomLayer(name: SpellVfxDomLayer): void {
  if (!root) return;
  layers.get(name)?.replaceChildren();
}
