/** Strip HTML, D&D Beyond link stubs, and leftover “Link Removed” copy. */
export function cleanStatBlockText(raw: string): string {
  if (!raw) return '';
  let s = raw.replace(/\r\n/g, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
  s = s.replace(/<a\b[^>]*>/gi, '');
  s = s.replace(/<\/a>/gi, '');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/https?:\/\/[^\s<>"']+/gi, '');
  s = s.replace(/\bLink Removed:?/gi, '');
  s = s.replace(/\bthe traits described in the\b/gi, '');
  s = s.replace(/\bsidebar in the\b/gi, '');
  s = s.replace(/\bThe \w+ has\.?(?=\s|$)/g, '');
  s = s.replace(/\(\s*\)/g, '');
  s = s.replace(/[^\S\n]+/g, ' ');
  s = s.replace(/[ \t]+([.,;:])/g, '$1');
  s = s.replace(/\n[ \t]+/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Strip HTML and collapse whitespace from DDB text fields. */
export function stripHtmlText(html: string): string {
  return cleanStatBlockText(html).replace(/\s+/g, ' ').trim();
}

/** Keep D&D Beyond-style paragraphs, headings, and bold option names. */
export function htmlToEntryText(raw: string): string {
  if (!raw) return '';
  let s = raw.replace(/\r\n/g, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<p[^>]*>/gi, '');
  s = s.replace(/<h[1-6][^>]*>/gi, '\n\n');
  s = s.replace(/<\/h[1-6]>/gi, '\n\n');
  s = s.replace(/<(strong|b)[^>]*>/gi, '**');
  s = s.replace(/<\/(strong|b)>/gi, '**');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  return cleanStatBlockText(s);
}

export type EntryBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

const NAMED_OPTION = /(?:^|(?<=(?:choice:|following:)\s)|(?<=\. ))([A-Z][a-zA-Z]+(?:[ -][A-Z][a-zA-Z]+){0,3})\.\s+(?=[A-Z])/g;
const SECTION_HEAD = /^(At Higher Levels|Using a Higher-Level Spell Slot|Cantrip Upgrade|Classes)\.?\s*/i;

export function parseEntryBlocks(text: string): EntryBlock[] {
  const source = htmlToEntryText(text);
  if (!source) return [];
  const chunks = source.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  const out: EntryBlock[] = [];

  for (const chunk of chunks) {
    const headingMark = chunk.match(/^\*\*(.+?)\*\*\.?\s*([\s\S]*)$/);
    if (headingMark) {
      out.push({ kind: 'heading', text: headingMark[1]!.trim().replace(/\.$/, '') });
      if (headingMark[2]?.trim()) out.push({ kind: 'paragraph', text: headingMark[2].trim() });
      continue;
    }

    const section = chunk.match(SECTION_HEAD);
    if (section) {
      out.push({ kind: 'heading', text: section[1]!.trim() });
      const rest = chunk.slice(section[0].length).trim();
      if (rest) out.push({ kind: 'paragraph', text: rest });
      continue;
    }

    const bullets = chunk.split('\n').filter((l) => /^[•*-]\s+/.test(l));
    if (bullets.length >= 2 && bullets.length === chunk.split('\n').filter(Boolean).length) {
      out.push({ kind: 'list', items: bullets.map((l) => l.replace(/^[•*-]\s+/, '').trim()) });
      continue;
    }

    const pieces = splitNamedOptions(chunk);
    if (pieces.length > 1) {
      for (const piece of pieces) {
        if (piece.title) out.push({ kind: 'heading', text: piece.title });
        if (piece.body) out.push({ kind: 'paragraph', text: piece.body });
      }
      continue;
    }

    out.push({ kind: 'paragraph', text: chunk });
  }

  return out;
}

function splitNamedOptions(chunk: string): Array<{ title?: string; body: string }> {
  const matches = [...chunk.matchAll(NAMED_OPTION)];
  if (matches.length < 2) return [{ body: chunk }];
  const parts: Array<{ title?: string; body: string }> = [];
  let last = 0;
  for (const m of matches) {
    const at = m.index ?? 0;
    if (at > last) {
      const lead = chunk.slice(last, at).trim();
      if (lead) parts.push({ body: lead });
    }
    const title = m[1]!.trim();
    last = at + m[0].length;
    const next = matches[matches.indexOf(m) + 1];
    const end = next?.index ?? chunk.length;
    const body = chunk.slice(last, end).trim();
    parts.push({ title, body });
    last = end;
  }
  return parts.filter((p) => p.body || p.title);
}

function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when detail text adds meaningful rules beyond the feature name. */
export function hasMeaningfulActionDetail(name: string, text: string | undefined): boolean {
  if (!text?.trim()) return false;
  const detail = stripHtmlText(text);
  if (detail.length < 12) return false;
  const n = normalizeLabel(name);
  const d = normalizeLabel(detail);
  if (d === n) return false;
  if (d.startsWith(n) && d.length - n.length < 8) return false;
  return true;
}
