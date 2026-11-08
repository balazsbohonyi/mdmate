/**
 * Which image addresses may load, and what the editor remembers about the images it has shown.
 *
 * A Markdown file is untrusted text, so its image addresses are an allowlist, not a blocklist:
 *
 * - a relative path that stays inside the document's own folder, or
 * - an `https` address.
 *
 * Everything else is refused: `http`, `file`, `data`, any other scheme, an absolute path, a drive
 * letter, a network (UNC) path, a path that leaves the folder, a Windows device name. Reading a
 * network path makes Windows contact that host, and an absolute path would reach any file the
 * asset protocol is allowed to serve, so neither is ever asked for.
 */
import { Facet } from '@codemirror/state'

/** What the editor needs from the app to show an image that sits next to the document. */
export interface ImageContext {
  /** The folder the document lives in, or null for a document with no file. Read at scan time. */
  folder(): string | null
  /** The address the webview loads for a file on disk (the asset protocol). */
  url(path: string): string
}

/** Provided per document. Without it no local image can load, and https images still can. */
export const imageContext = Facet.define<ImageContext, ImageContext | null>({
  combine: (values) => values[0] ?? null,
})

export type ImageAddress =
  | { readonly kind: 'local'; readonly path: string }
  | { readonly kind: 'remote'; readonly url: string }
  | { readonly kind: 'refused' }

const REFUSED: ImageAddress = { kind: 'refused' }

/** Names Windows treats as devices, in any folder and with any extension. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i
/** Characters no Windows file name can hold, and the drive separator. */
const ILLEGAL = /[<>:"|?*]/
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f]/

/** `%41` becomes `A`. An address that is not valid percent-encoding is taken as written. */
function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function resolveLocal(address: string, folder: string): ImageAddress {
  // The query or fragment is not part of a file name.
  const cut = address.search(/[?#]/)
  const raw = cut < 0 ? address : address.slice(0, cut)
  const decoded = decode(raw)
  if (CONTROL.test(decoded) || ILLEGAL.test(decoded)) return REFUSED
  const unified = decoded.replaceAll('\\', '/')
  // `/etc/x`, `\\host\share` and `//host/share` all start with a separator.
  if (unified.startsWith('/')) return REFUSED

  const parts: string[] = []
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // One step above the document's folder is a different folder.
      if (parts.pop() === undefined) return REFUSED
      continue
    }
    // Windows drops trailing dots and spaces, so `a.png.` and `a.png` would be one file.
    if (part.endsWith('.') || part.endsWith(' ')) return REFUSED
    const stem = part.split('.')[0] ?? part
    if (DEVICE_NAME.test(stem.trim())) return REFUSED
    parts.push(part)
  }
  if (parts.length === 0) return REFUSED

  // The separator is the folder's own, read before a root such as `D:\` loses its trailing one.
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  const base = folder.replace(/[\\/]+$/, '')
  if (base === '') return REFUSED
  return { kind: 'local', path: `${base}${separator}${parts.join(separator)}` }
}

function resolveRemote(address: string): ImageAddress {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return REFUSED
  }
  if (url.protocol !== 'https:' || url.hostname === '') return REFUSED
  // Credentials in an address would be sent to that host.
  if (url.username !== '' || url.password !== '') return REFUSED
  return { kind: 'remote', url: url.href }
}

/**
 * Decides what an image address in the document may load. `folder` is the document's folder, or
 * null when it has none (then no relative path can resolve).
 */
export function resolveImageAddress(raw: string, folder: string | null): ImageAddress {
  let address = raw.trim()
  if (address.startsWith('<') && address.endsWith('>')) address = address.slice(1, -1).trim()
  if (address === '' || CONTROL.test(address)) return REFUSED
  // Any scheme at all (`https:`, `file:`, `C:`) means this is not a relative path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) {
    return /^https:/i.test(address) ? resolveRemote(address) : REFUSED
  }
  if (folder === null) return REFUSED
  return resolveLocal(address, folder)
}

export interface ImageSize {
  readonly width: number
  readonly height: number
}

/** More than a long document has, small enough to forget about. */
const SIZE_LIMIT = 1000
const sizes = new Map<string, ImageSize>()

/** The size an image had when it last loaded, so the next draw can reserve exactly its space. */
export function imageSizeOf(url: string): ImageSize | undefined {
  return sizes.get(url)
}

export function rememberImageSize(url: string, width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
  // Re-inserting moves the entry to the end, so the oldest is what goes first.
  sizes.delete(url)
  sizes.set(url, { width, height })
  if (sizes.size > SIZE_LIMIT) {
    const oldest = sizes.keys().next()
    if (oldest.done !== true) sizes.delete(oldest.value)
  }
}

/** For tests. */
export function resetImageSizes(): void {
  sizes.clear()
}
