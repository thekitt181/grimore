import type { CompendiumGlobalDoc, OwlbearRawGlobalDoc } from '@grimoire/shared';
import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';

let cache: { at: number; version: string | null; doc: CompendiumGlobalDoc | null } | null = null;
const CACHE_MS = 2_000;
const DOWN_COOLDOWN_MS = 8_000;
const FETCH_TIMEOUT_MS = 1_500;
const VERSION_TIMEOUT_MS = 800;

let extensionDownUntil = 0;

/** Host root (`http://localhost:3000`) or API base (`https://…/api`). */
function extensionApiBase(): string {
  const raw = (process.env['OWLBear_API_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
  if (raw.endsWith('/api')) return raw;
  return `${raw}/api`;
}

function isRemoteExtensionApi(): boolean {
  const base = extensionApiBase();
  return !base.includes('localhost') && !base.includes('127.0.0.1');
}

function extensionFetchTimeoutMs(): number {
  return isRemoteExtensionApi() ? 45_000 : FETCH_TIMEOUT_MS;
}

function extensionVersionTimeoutMs(): number {
  return isRemoteExtensionApi() ? 15_000 : VERSION_TIMEOUT_MS;
}

function extensionApiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${extensionApiBase()}${suffix}`;
}

export async function fetchExtensionVersion(): Promise<string | null> {
  if (extensionDownUntil > Date.now()) return null;
  const url = extensionApiUrl('/data/version');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(extensionVersionTimeoutMs()) });
    if (!res.ok) return null;
    const data = (await res.json()) as { lastUpdated?: string | null };
    return data.lastUpdated ? new Date(data.lastUpdated).toISOString() : null;
  } catch {
    // Version probe failure is non-fatal — do not block extension reads for long.
    return null;
  }
}

/** Pull the Owlbear extension global doc (reads Mongo on the extension server). */
export async function fetchExtensionGlobalDoc(force = false): Promise<CompendiumGlobalDoc | null> {
  const now = Date.now();
  if (!force && extensionDownUntil > now) return null;
  if (!force && cache && now - cache.at < CACHE_MS) {
    return cache.doc;
  }

  const version = force ? null : await fetchExtensionVersion();
  if (!force && version && cache?.version === version && cache.doc) {
    cache = { ...cache, at: now };
    return cache.doc;
  }

  const url = extensionApiUrl('/data');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(extensionFetchTimeoutMs()) });
    if (!res.ok) {
      extensionDownUntil = now + DOWN_COOLDOWN_MS;
      cache = { at: now, version: null, doc: null };
      return null;
    }
    const raw = (await res.json()) as OwlbearRawGlobalDoc;
    const doc = normalizeOwlbearGlobalDoc(raw);
    const docVersion = doc.lastUpdated ? new Date(doc.lastUpdated).toISOString() : version;
    cache = { at: now, version: docVersion, doc };
    extensionDownUntil = 0;
    return doc;
  } catch {
    extensionDownUntil = now + DOWN_COOLDOWN_MS;
    cache = { at: now, version: null, doc: null };
    return null;
  }
}

export function invalidateExtensionGlobalCache(): void {
  cache = null;
  extensionDownUntil = 0;
}

/** Wake extension SSE clients after a direct Grimoire Mongo write (backup to change stream). */
export async function notifyExtensionDataChanged(lastUpdated: string): Promise<void> {
  if (process.env['OWLBear_SKIP_EXTENSION'] === '1') return;
  const url = extensionApiUrl('/data/notify');
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastUpdated }),
      signal: AbortSignal.timeout(isRemoteExtensionApi() ? 10_000 : 2_000),
    });
  } catch {
    // Non-fatal — Mongo change stream on the extension server is the primary path.
  }
}
