import { authHeaders, type DdbAuthContext } from './ddbAuthContext';
import type { DdbSourceSummary } from '@grimoire/shared';

const LIBRARY_URL =
  'https://www.dndbeyond.com/en/library?type=sourcebooks&ownership=owned-shared';

export type DdbLibraryBook = {
  name: string;
  slug: string;
  isOwned: boolean;
  isShared: boolean;
};

type LibrarySourceRaw = {
  name?: string;
  relativePath?: string;
  isOwned?: boolean;
  isSharedWithMe?: boolean;
  id?: number;
  sourceId?: number;
};

/** Bracket-balance a JSON array starting at `openIdx`. */
function findMatchingBracket(s: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (inStr) {
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']' && (depth -= 1) === 0) return i;
  }
  return -1;
}

/** Parse owned/shared books from the DDB library page RSC payload. */
export function parseLibraryBooksFromHtml(html: string): DdbLibraryBook[] {
  const chunks: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      chunks.push(JSON.parse(`"${m[1]}"`));
    } catch {
      // skip malformed chunk
    }
  }
  const combined = chunks.join('');

  const collected: LibrarySourceRaw[] = [];
  let from = 0;
  while (true) {
    const keyAt = combined.indexOf('"sources":[', from);
    if (keyAt < 0) break;
    const arrayStart = combined.indexOf('[', keyAt);
    const end = findMatchingBracket(combined, arrayStart);
    if (end < 0) break;
    try {
      const arr = JSON.parse(combined.slice(arrayStart, end + 1)) as LibrarySourceRaw[];
      collected.push(...arr);
    } catch {
      // try next occurrence
    }
    from = end + 1;
  }

  const bySlug = new Map<string, DdbLibraryBook>();
  for (const s of collected) {
    if (!s.isOwned && !s.isSharedWithMe) continue;
    const name = String(s.name ?? '').trim();
    const relPath = String(s.relativePath ?? '').trim();
    const slug = relPath.startsWith('/sources/')
      ? relPath.slice('/sources/'.length)
      : relPath.replace(/^\/+/, '');
    if (!name) continue;
    const key = slug || name.toLowerCase();
    if (!key || bySlug.has(key)) continue;
    bySlug.set(key, {
      name,
      slug,
      isOwned: Boolean(s.isOwned),
      isShared: Boolean(s.isSharedWithMe),
    });
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSourceKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[''""]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Map library page book names to config/catalog source ids. */
export function mapLibraryBooksToCatalogIds(
  books: DdbLibraryBook[],
  catalog: DdbSourceSummary[],
): Set<number> {
  const byKey = new Map<string, number>();
  for (const source of catalog) {
    byKey.set(normalizeSourceKey(source.name), source.id);
  }

  const ids = new Set<number>();
  for (const book of books) {
    const key = normalizeSourceKey(book.name);
    const exact = byKey.get(key);
    if (exact != null) {
      ids.add(exact);
      continue;
    }

    let matched: number | null = null;
    for (const source of catalog) {
      const sk = normalizeSourceKey(source.name);
      if (sk.includes(key) || key.includes(sk)) {
        matched = source.id;
        break;
      }
    }
    if (matched != null) ids.add(matched);
  }
  return ids;
}

export async function fetchOwnedLibraryBooks(ctx: DdbAuthContext): Promise<DdbLibraryBook[]> {
  try {
    const res = await fetch(LIBRARY_URL, {
      headers: {
        ...authHeaders(ctx),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Foundry VTT Character Integrator',
      },
    });
    if (!res.ok) {
      console.warn('[DDB] library page fetch failed', res.status);
      return [];
    }
    const html = await res.text();
    const books = parseLibraryBooksFromHtml(html);
    if (books.length === 0) {
      console.warn('[DDB] no owned/shared books parsed from library page');
    }
    return books;
  } catch (err) {
    console.warn('[DDB] library page fetch error:', err instanceof Error ? err.message : err);
    return [];
  }
}
