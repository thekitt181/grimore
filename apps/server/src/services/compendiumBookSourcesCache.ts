import fs from 'fs';
import path from 'path';
import type { CompendiumSource } from '@grimoire/shared';

interface PersistedBookSourcesDoc {
  savedAt: string;
  sources: CompendiumSource[];
}

let memoryCache: CompendiumSource[] | null = null;

function bookSourcesPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'apps/server/data/book-sources.json'),
    path.resolve(process.cwd(), 'data/book-sources.json'),
  ];
  for (const p of candidates) {
    const dir = path.dirname(p);
    if (fs.existsSync(dir)) return p;
  }
  return candidates[0]!;
}

export function getMemoryBookSources(): CompendiumSource[] | null {
  return memoryCache;
}

export function setMemoryBookSources(sources: CompendiumSource[]): void {
  memoryCache = sources.length > 0 ? sources : null;
}

export function invalidateBookSourcesCache(): void {
  memoryCache = null;
}

export function loadPersistedBookSources(): CompendiumSource[] | null {
  const filePath = bookSourcesPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistedBookSourcesDoc;
    const sources = parsed?.sources;
    return Array.isArray(sources) && sources.length > 0 ? sources : null;
  } catch {
    return null;
  }
}

export function savePersistedBookSources(sources: CompendiumSource[]): void {
  if (sources.length === 0) return;
  const filePath = bookSourcesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const doc: PersistedBookSourcesDoc = {
    savedAt: new Date().toISOString(),
    sources,
  };
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf8');
  setMemoryBookSources(sources);
}

/** Load disk cache into memory on startup — instant Books tab without Mongo. */
export function warmBookSourcesCacheFromDisk(): void {
  const disk = loadPersistedBookSources();
  if (disk) setMemoryBookSources(disk);
}
