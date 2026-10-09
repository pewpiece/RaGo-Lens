/** Markdown produced by formatScan (or edited by the user) -> readable plain text. */
export function markdownToPlain(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      let l = line.replace(/\s+$/, ''); // hard-break trailing spaces
      l = l.replace(/^(\s*)#{1,6}\s+/, '$1');
      l = l.replace(/^(\s*)[-*+]\s+/, '$1• ');
      return l;
    })
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
