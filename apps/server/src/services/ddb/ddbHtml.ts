/** Strip DDB HTML snippets to plain text for compendium stat blocks. */
export function stripDdbHtml(html: unknown): string {
  if (html == null) return '';
  if (typeof html === 'object') return '';
  const raw = String(html);
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function joinSections(sections: Array<{ title: string; body: unknown }>): string {
  const parts: string[] = [];
  for (const section of sections) {
    const body = stripDdbHtml(section.body);
    if (!body) continue;
    parts.push(`${section.title}\n${body}`);
  }
  return parts.join('\n\n');
}
