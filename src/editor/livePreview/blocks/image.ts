/**
 * Which image addresses may load, and what the editor remembers about the images it has shown.
 *
 * A Markdown file is untrusted text, so its image addresses are an allowlist, not a blocklist:
 *
 * - a relative path that stays inside the document's own folder, or inside the workspace folder
 *   the document is in (so `../img/p.png` works from `notes/b.md`), or
 * - an `https` address.
 *
 * Everything else is refused: `http`, `file`, `data`, any other scheme, an absolute path, a drive
 * letter, a network (UNC) path, a path that leaves that boundary, a Windows device name. Reading a
 * network path makes Windows contact that host, and an absolute path would reach any file the
 * asset protocol is allowed to serve, so neither is ever asked for.
 */
import { Facet } from '@codemirror/state'

/** What the editor needs from the app to show an image that sits next to the document. */
export interface ImageContext {
  /** The folder the document lives in, or null for a document with no file. Read at scan time. */
  folder(): string | null
  /**
   * The workspace folder that holds the document, or null when it is in none. A relative path may
   * climb out of the document's folder, but never out of this one. Read at scan time.
   */
  boundary(): string | null
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

/** How many folders there are from `boundary` down to `folder`: how far up a path may climb. */
function climbAllowance(folder: string, boundary: string | null): number {
  if (boundary === null) return 0
  const top = boundary.replace(/[\\/]+$/, '')
  const base = folder.replace(/[\\/]+$/, '')
  if (!base.startsWith(top)) return 0
  const rest = base.slice(top.length)
  // Whole folder names only: `/a/bc` is not inside `/a/b`.
  if (rest !== '' && !/^[\\/]/.test(rest)) return 0
  return rest.split(/[\\/]/).filter((part) => part !== '').length
}

function resolveLocal(address: string, folder: string, boundary: string | null): ImageAddress {
  // The query or fragment is not part of a file name.
  const cut = address.search(/[?#]/)
  const raw = cut < 0 ? address : address.slice(0, cut)
  const decoded = decode(raw)
  if (CONTROL.test(decoded) || ILLEGAL.test(decoded)) return REFUSED
  const unified = decoded.replaceAll('\\', '/')
  // `/etc/x`, `\\host\share` and `//host/share` all start with a separator.
  if (unified.startsWith('/')) return REFUSED

  const parts: string[] = []
  const mayClimb = climbAllowance(folder, boundary)
  let climbed = 0
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.pop() !== undefined) continue
      // Above the document's folder is another folder: allowed up to the workspace folder, and no
      // further. A document in no workspace folder may not climb at all.
      if (climbed >= mayClimb) return REFUSED
      climbed++
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
  let base = folder.replace(/[\\/]+$/, '')
  for (let step = 0; step < climbed; step++) {
    base = base.slice(0, Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\')))
  }
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
 * null when it has none (then no relative path can resolve). `boundary` is the workspace folder
 * the document is in: a path may climb out of `folder` as far as it, and no further.
 */
export function resolveImageAddress(
  raw: string,
  folder: string | null,
  boundary: string | null = null,
): ImageAddress {
  let address = raw.trim()
  if (address.startsWith('<') && address.endsWith('>')) address = address.slice(1, -1).trim()
  if (address === '' || CONTROL.test(address)) return REFUSED
  // Any scheme at all (`https:`, `file:`, `C:`) means this is not a relative path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) {
    return /^https:/i.test(address) ? resolveRemote(address) : REFUSED
  }
  if (folder === null) return REFUSED
  return resolveLocal(address, folder, boundary)
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

/**
 * Pictures from disk are read again when they are drawn again, not served from the webview's own
 * memory. The webview keeps every image it has loaded under its address for as long as the page
 * lives, whatever the file does afterwards: a deleted picture kept drawing, even in a tab closed and
 * opened again, until the app restarted. A local picture's address therefore carries a number that
 * goes up whenever its files may have changed (a document opens, the window gets the focus back),
 * which makes it a new address to the webview. The asset protocol ignores the query string.
 */
let epoch = 0

/** The pictures of a local file are served by Tauri under one of these. Nothing else gets a number. */
const ASSET_URL = /^(?:https?:\/\/asset\.localhost\/|asset:\/\/localhost\/)/i

/** From now on, pictures drawn are read from disk again. Nothing already on screen changes. */
export function bumpImageEpoch(): void {
  epoch += 1
}

/** `src` as an `<img>` should load it now: a local file's address with the current number, else as is. */
export function freshImageSrc(src: string): string {
  if (epoch === 0 || !ASSET_URL.test(src)) return src
  return `${src}${src.includes('?') ? '&' : '?'}v=${String(epoch)}`
}

/** `src` without the number `freshImageSrc` added. */
export function plainImageSrc(src: string): string {
  return src.replace(/[?&]v=\d+$/, '')
}

const refreshers = new Set<() => void>()

/** Calls `run` whenever `refreshPictures` is. Returns what stops it. */
export function onPicturesRefresh(run: () => void): () => void {
  refreshers.add(run)
  return () => refreshers.delete(run)
}

/** The files may have changed under every picture on screen: read them again, in place. */
export function refreshPictures(): void {
  bumpImageEpoch()
  for (const run of [...refreshers]) run()
}

/** For tests. */
export function resetImageEpoch(): void {
  epoch = 0
}
