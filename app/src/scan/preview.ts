export interface PreviewLine {
  text: string;
  heading: boolean;
  blank: boolean;
}

/** The heading lines of a scan, taken from its Markdown layout (lines that start with #). */
export function headingSet(markdown: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const line of (markdown ?? '').split('\n')) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (m) set.add(m[1]!.trim());
  }
  return set;
}

/**
 * Lines for the preview, where headings are shown larger. A line is a heading when it starts with # (Markdown view)
 * or matches a heading found by the scan, so it still works after the user has edited other parts of the text.
 * Plain text cannot carry a font size, so the size exists only in this preview.
 */
export function previewLines(text: string, headings: Set<string>): PreviewLine[] {
  return text.split('\n').map((raw) => {
    const md = /^#{1,6}\s+(.+)$/.exec(raw.trim());
    const t = md ? md[1]!.trim() : raw;
    return {
      text: t,
      heading: !!md || (t.trim() !== '' && headings.has(t.trim())),
      blank: raw.trim() === '',
    };
  });
}
