/** Strip HTML and collapse whitespace from DDB text fields. */
export function stripHtmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
