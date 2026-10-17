import { ZipReader, BlobReader, configure } from '@zip.js/zip.js';

configure({ useWebWorkers: false });
const MAX_EXPANDED = 3 * 1024 ** 3;

export function safePath(path) {
  const normalized = path.replace(/\/$/, '');
  if (!normalized || path.includes('\\') || path.includes('\0') || normalized.split('/').some((part) => !part || part === '..' || part === '.' || part.includes(':'))) throw new Error('Archive contains an unsafe path.');
  return normalized;
}

export async function extractIPA(file, FS, progress) {
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    if (entries.length > 100_000) throw new Error('IPA contains too many files.');
    const seen = new Set();
    let total = 0;
    for (const entry of entries) {
      const path = safePath(entry.filename);
      if (seen.has(path)) throw new Error('Archive contains duplicate paths.');
      seen.add(path);
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('IPA contains unsupported symbolic links.');
      if (entry.encrypted) throw new Error('Password-protected IPA archives are not supported.');
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > 1024 ** 3) throw new Error('An IPA entry exceeds the browser memory limit.');
      total += entry.uncompressedSize;
      if (total > MAX_EXPANDED) throw new Error('IPA exceeds the 3 GB expanded browser limit.');
    }
    const roots = entries.filter((entry) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry.filename));
    if (roots.length !== 1) throw new Error('Select an IPA containing exactly one app in Payload/.');
    let completed = 0;
    let previousPercent = -1;
    for (const entry of entries) {
      const path = `/work/ipa/${safePath(entry.filename)}`;
      if (entry.directory) { FS.mkdirTree(path); continue; }
      FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
      FS.writeFile(path, new Uint8Array(entry.uncompressedSize), { canOwn: true });
      const stream = FS.open(path, 'r+');
      let position = 0;
      try {
        await entry.getData(new WritableStream({ write(chunk) {
          if (position + chunk.length > entry.uncompressedSize) throw new Error('Invalid archive entry size.');
          FS.write(stream, chunk, 0, chunk.length, position);
          position += chunk.length;
        } }), { checkSignature: true });
        if (position !== entry.uncompressedSize) throw new Error('Incomplete archive entry.');
      } finally { FS.close(stream); }
      FS.chmod(path, mode & 0o777 || 0o644);
      completed += entry.uncompressedSize;
      const percent = Math.round(completed / Math.max(total, 1) * 100);
      if (percent !== previousPercent) progress(`Unpacking IPA · ${percent}%`);
      previousPercent = percent;
    }
    return `/work/ipa/${roots[0].filename.slice(0, -'/Info.plist'.length)}`;
  } finally { await reader.close(); }
}

export function filesUnder(FS, root) {
  const files = [];
  for (const name of FS.readdir(root)) {
    if (name === '.' || name === '..') continue;
    const path = `${root}/${name}`;
    const stat = FS.lstat(path);
    if (FS.isDir(stat.mode)) files.push(...filesUnder(FS, path));
    else if (FS.isFile(stat.mode)) files.push(path);
  }
  return files;
}
