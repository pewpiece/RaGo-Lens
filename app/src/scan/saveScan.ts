import type { ResultRow } from '@/db/schema';
import { tempName, writeCacheFile } from '@/lib/files';
import { saveItem, writeItemText } from '@/library/library';
import type { ScanResult } from './pipeline';
import type { TextFormat } from './types';

export interface ScanSaveDeps {
  /** Small JPEG preview of the scanned page (returns a temp file URI). */
  makeThumb: (photoUri: string) => Promise<string>;
}

/** Saves a finished scan (photo + text + thumbnail) to the library as a `scan` item. */
export async function saveScanToLibrary(
  r: ScanResult,
  text: string,
  deps: ScanSaveDeps,
  format: TextFormat = 'plain',
): Promise<ResultRow> {
  const thumbUri = await deps.makeThumb(r.workingUri);
  const textUri = writeCacheFile(
    tempName('scan', format === 'markdown' ? 'md' : 'txt'),
    new TextEncoder().encode(text),
  );
  return saveItem({
    mode: 'scan',
    originalUri: r.workingUri,
    resultUri: textUri,
    thumbUri,
    width: r.width,
    height: r.height,
    settings: {
      engine: r.engineId,
      script: r.script,
      chars: r.charCount,
      format,
      // every layout is kept so the format can be switched when the scan is reopened
      texts: {
        plain: r.formatted.plain,
        paragraphs: r.formatted.paragraphs,
        markdown: r.formatted.markdown,
      },
    },
  });
}

/** Persist edits made in the text editor. Returns false if the library item no longer exists. */
export function saveScanText(itemId: string, text: string): boolean {
  return writeItemText(itemId, text);
}
