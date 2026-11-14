/**
 * Where a document's text links to `assets/<name>`, and what it becomes when an image changes name.
 *
 * The first Save As of an untitled document copies its draft images next to the new file, and a name
 * that is taken there gets `-2`, `-3`. Rust writes the file with the links already updated; this is
 * the same rule for the text the page holds, so the document is not left edited-looking and its
 * pictures keep loading. `src-tauri/src/drafts.rs` (`link_uses`) has the same rule and both read
 * `tests/data/draft-links.json`.
 */

/** The folder an image goes in, beside its document. */
const FOLDER = 'assets/'

/** One use of `assets/<name>`: where the name starts and ends in the text, and which name it is. */
export interface LinkUse {
  readonly start: number
  readonly end: number
  readonly name: string
}

const NAME = /[\p{Alphabetic}\p{N}_-]/u
const WORD = /[\p{Alphabetic}\p{N}]/u

/** A character that is part of a name, so a link found next to it is a different link. */
function nameChar(char: string): boolean {
  return NAME.test(char)
}

/** A character that makes `assets/` part of a longer path rather than the start of a link. */
function pathChar(char: string): boolean {
  return nameChar(char) || '.\\/:'.includes(char)
}

/** The character just before `end` in `text`, whole when it is outside the Basic Multilingual Plane. */
function charBefore(text: string, end: number): string | null {
  if (end <= 0) return null
  const last = text.codePointAt(end - 1)
  if (last === undefined) return null
  const pair = end >= 2 ? text.codePointAt(end - 2) : undefined
  if (pair !== undefined && pair > 0xffff) return String.fromCodePoint(pair)
  return String.fromCodePoint(last)
}

/** Whether the text before `at` lets `assets/` start a link there: `./` counts, a longer path does not. */
function startsLink(text: string, at: number): boolean {
  const dotSlash = at >= 2 && text.slice(at - 2, at) === './'
  const before = charBefore(text, dotSlash ? at - 2 : at)
  return before === null || !pathChar(before)
}

/** Whether the name ending at `end` ends the link, so `a.png2` and `a.png.bak` are other files. */
function endsHere(text: string, end: number): boolean {
  if (end >= text.length) return true
  const next = String.fromCodePoint(text.codePointAt(end) ?? 0)
  if (next !== '.') return !nameChar(next)
  const after = end + 1 >= text.length ? null : String.fromCodePoint(text.codePointAt(end + 1) ?? 0)
  return after === null || !WORD.test(after)
}

/** Every use of `assets/<name>` for one of `names`, in the order they appear. */
export function draftLinkUses(text: string, names: Iterable<string>): LinkUse[] {
  const wanted = [...names]
  const found: LinkUse[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(FOLDER, from)
    if (at < 0) return found
    from = at + 1
    if (!startsLink(text, at)) continue
    const start = at + FOLDER.length
    for (const name of wanted) {
      if (!text.startsWith(name, start)) continue
      const end = start + name.length
      if (!endsHere(text, end)) continue
      found.push({ start, end, name })
      break
    }
  }
}

/** The edits that point each use of a renamed image's link at its new name, in one pass. */
export function renameEdits(
  text: string,
  renames: ReadonlyMap<string, string>,
): { from: number; to: number; insert: string }[] {
  if (renames.size === 0) return []
  const edits: { from: number; to: number; insert: string }[] = []
  for (const use of draftLinkUses(text, renames.keys())) {
    const to = renames.get(use.name)
    if (to !== undefined && to !== use.name)
      edits.push({ from: use.start, to: use.end, insert: to })
  }
  return edits
}

/** `text` with the links of renamed images updated. */
export function rewriteDraftLinks(text: string, renames: ReadonlyMap<string, string>): string {
  let out = ''
  let last = 0
  for (const edit of renameEdits(text, renames)) {
    out += text.slice(last, edit.from) + edit.insert
    last = edit.to
  }
  return out + text.slice(last)
}
