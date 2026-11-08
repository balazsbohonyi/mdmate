/**
 * What the link guard in Rust (`src-tauri/src/links/`) says about a link. The page sends the
 * document id and the target as written; it never names a path or a URL to open. These types
 * mirror the Rust `LinkInfo` and `Followed`, and change in the same commit as them.
 */

/** Why the guard refused a target. Mirrors `Refusal::as_str` in `links/guard.rs`. */
export type LinkRefusal =
  | 'empty'
  | 'control-character'
  | 'scheme'
  | 'bad-web-address'
  | 'network'
  | 'absolute'
  | 'bad-name'
  | 'executable'
  | 'folder'
  | 'bad-escape'

/** Where a link leads. Nothing is opened or granted by asking. */
export type LinkInfo =
  | { readonly kind: 'anchor'; readonly fragment: string }
  | { readonly kind: 'web'; readonly url: string }
  | { readonly kind: 'markdown'; readonly path: string; readonly fragment: string | null }
  | { readonly kind: 'image'; readonly path: string }
  /** Opens in its default app only after the user says yes. */
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'missing'; readonly path: string }
  | { readonly kind: 'refused'; readonly reason: LinkRefusal }

/** What following a link did. */
export type FollowedLink =
  /** A heading in the same document: the page moves the caret. */
  | { readonly kind: 'anchor'; readonly fragment: string }
  /** Handed to the browser, the mail app or the file's default app. */
  | { readonly kind: 'opened' }
  /** A Markdown file Rust now lets the page open, by this path. */
  | { readonly kind: 'document'; readonly path: string; readonly fragment: string | null }

const REFUSALS: readonly string[] = [
  'empty',
  'control-character',
  'scheme',
  'bad-web-address',
  'network',
  'absolute',
  'bad-name',
  'executable',
  'folder',
  'bad-escape',
] satisfies readonly LinkRefusal[]

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('not an object')
  // Narrowed above; an object's own fields are read one by one below.
  return value as Record<string, unknown>
}

function text(value: Record<string, unknown>, field: string): string {
  const found = value[field]
  if (typeof found !== 'string') throw new Error(`${field} is not a string`)
  return found
}

function optionalText(value: Record<string, unknown>, field: string): string | null {
  const found = value[field]
  if (found === null || found === undefined) return null
  if (typeof found !== 'string') throw new Error(`${field} is not a string`)
  return found
}

/** Checks what Rust returned for `describe_link`. */
export function parseLinkInfo(raw: unknown): LinkInfo {
  const value = record(raw)
  const kind = value.kind
  switch (kind) {
    case 'anchor':
      return { kind, fragment: text(value, 'fragment') }
    case 'web':
      return { kind, url: text(value, 'url') }
    case 'markdown':
      return { kind, path: text(value, 'path'), fragment: optionalText(value, 'fragment') }
    case 'image':
    case 'file':
    case 'missing':
      return { kind, path: text(value, 'path') }
    case 'refused': {
      const reason = text(value, 'reason')
      if (!REFUSALS.includes(reason)) throw new Error(`unknown refusal ${reason}`)
      // Checked against the list just above.
      return { kind, reason: reason as LinkRefusal }
    }
    default:
      throw new Error(`unknown link kind ${String(kind)}`)
  }
}

/** Checks what Rust returned for `follow_link`. */
export function parseFollowedLink(raw: unknown): FollowedLink {
  const value = record(raw)
  const kind = value.kind
  switch (kind) {
    case 'anchor':
      return { kind, fragment: text(value, 'fragment') }
    case 'opened':
      return { kind }
    case 'document':
      return { kind, path: text(value, 'path'), fragment: optionalText(value, 'fragment') }
    default:
      throw new Error(`unknown follow result ${String(kind)}`)
  }
}
