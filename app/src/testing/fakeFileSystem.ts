/**
 * In-memory stand-in for expo-file-system's object API, faithful to its sync/async split:
 * copy()/move() return promises (and do the work later), copySync()/moveSync() do it immediately.
 * Use: jest.mock('expo-file-system', () => require('@/testing/fakeFileSystem').fakeFileSystem());
 */
export function fakeFileSystem() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const state = { available: 10 * 1024 * 1024 * 1024 };
  const join = (parts: unknown[]): string =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .reduce((a, b) => `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`);

  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    create() {
      if (!files.has(this.uri)) files.set(this.uri, new Uint8Array(0));
    }
    write(content: string | Uint8Array) {
      files.set(
        this.uri,
        typeof content === 'string' ? new TextEncoder().encode(content) : content,
      );
    }
    async text() {
      const b = files.get(this.uri);
      if (!b) throw new Error('not found');
      return new TextDecoder().decode(b);
    }
    async bytes() {
      const b = files.get(this.uri);
      if (!b) throw new Error('not found');
      return b;
    }
    delete() {
      files.delete(this.uri);
    }
    copySync(dest: File) {
      const b = files.get(this.uri);
      if (!b) throw new Error(`copy: source missing ${this.uri}`);
      files.set(dest.uri, b);
    }
    moveSync(dest: File) {
      this.copySync(dest);
      files.delete(this.uri);
    }
    async copy(dest: File) {
      await Promise.resolve();
      this.copySync(dest);
    }
    async move(dest: File) {
      await Promise.resolve();
      this.moveSync(dest);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return dirs.has(this.uri);
    }
    create() {
      dirs.add(this.uri);
    }
    delete() {
      dirs.delete(this.uri);
      for (const k of [...files.keys()]) if (k.startsWith(`${this.uri}/`)) files.delete(k);
    }
  }
  const Paths = {
    document: new Directory('file:///docs'),
    cache: new Directory('file:///cache'),
    get availableDiskSpace() {
      return state.available;
    },
  };
  return { File, Directory, Paths, __files: files, __state: state };
}
