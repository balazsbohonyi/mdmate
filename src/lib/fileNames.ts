/**
 * Which names a file or folder may have. Rust checks every name again (`workspace/ops.rs`), so this
 * is for the person typing: the message appears under the box before anything is sent. The rules
 * are Windows' on every OS, so a folder behaves the same wherever it is opened.
 */

const NAME_LIMIT = 255

/** Names Windows reads as devices, with or without an extension. Mirrors `links/guard.rs`. */
const DEVICES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'conin$',
  'conout$',
  'clock$',
  ...Array.from({ length: 10 }, (_, i) => `com${String(i)}`),
  ...Array.from({ length: 10 }, (_, i) => `lpt${String(i)}`),
  'com¹',
  'com²',
  'com³',
  'lpt¹',
  'lpt²',
  'lpt³',
])

// eslint-disable-next-line no-control-regex -- control characters are the point of this pattern
const FORBIDDEN = /[\u0000-\u001f\u007f/\\:<>"|?*]/

/** True for a name Windows reserves (`con`, `NUL.txt`, `COM1`), whatever its extension. */
export function isDeviceName(name: string): boolean {
  const stem = (name.split('.')[0] ?? name).replace(/ +$/, '')
  return DEVICES.has(stem.toLowerCase())
}

/** Why `name` cannot be a file or folder name, or null when it can. */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return 'A name cannot be empty.'
  if (name === '.' || name === '..') return 'A name cannot be a path part.'
  if (name.length > NAME_LIMIT) return 'That name is too long.'
  if (FORBIDDEN.test(name)) return 'A name cannot contain \\ / : * ? " < > | or control characters.'
  if (/[. ]$/.test(name)) return 'A name cannot end in a dot or a space.'
  if (isDeviceName(name)) return 'Windows reserves that name.'
  return null
}

/**
 * `name`, then `name (2)`, `name (3)` and so on, until `taken` says no. The number goes before the
 * extension of a file; a folder or a dotfile takes it at the end. Like Rust's Keep both.
 */
export function freeName(
  name: string,
  isFolder: boolean,
  taken: (candidate: string) => boolean,
): string {
  const dot = name.lastIndexOf('.')
  const split = !isFolder && dot > 0 && dot + 1 < name.length
  const stem = split ? name.slice(0, dot) : name
  const extension = split ? name.slice(dot) : ''
  for (let number = 2; ; number++) {
    const candidate = `${stem} (${String(number)})${extension}`
    if (!taken(candidate)) return candidate
  }
}
