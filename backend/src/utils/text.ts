import path from 'node:path';

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'challenge';
}

/** File types we keep the extension for; everything else is stored as .bin. */
const SAFE_EXTENSIONS = new Set([
  'zip', '7z', 'tar', 'gz', 'tgz', 'xz', 'bz2', 'rar',
  'txt', 'md', 'log', 'csv', 'json', 'xml', 'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'wav', 'mp3', 'mp4',
  'pcap', 'pcapng', 'cap', 'img', 'iso', 'bin', 'raw', 'mem', 'dmp',
  'apk', 'elf', 'exe', 'dll', 'so', 'jar', 'pyc', 'py', 'c', 'js',
]);

/** Extension used for the random on-disk filename. Never taken verbatim from the client. */
export function safeStoredExtension(originalName: string): string {
  const ext = path.extname(originalName).slice(1).toLowerCase();
  return SAFE_EXTENSIONS.has(ext) ? ext : 'bin';
}

/** Display name for a download: no path components, control characters or odd symbols. */
export function sanitizeDisplayFilename(originalName: string): string {
  const base = originalName.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .normalize('NFKC')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 100);
  return cleaned || 'attachment.bin';
}

export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
