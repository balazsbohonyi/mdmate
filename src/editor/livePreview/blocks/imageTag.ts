/**
 * Reading an `<img>` tag the owner wrote (or a resize wrote) into the document. A Markdown file
 * is untrusted text, so this is an allowlist twice over: only a tag that is exactly one `<img ...>`
 * on one line is read, and of its attributes only `src`, `alt`, `title`, `width` and `height` are
 * kept. Nothing else survives to the page: no `style`, no `on*` handler, no `srcset`, no `class`.
 * The address still goes through the same allowlist as a Markdown image (`resolveImageAddress`).
 */

export interface ImgTag {
  /** The raw address, as written (entities read), not yet checked by the allowlist. */
  readonly src: string
  readonly alt: string
  readonly title: string | null
  /** A whole number of CSS pixels, or null when absent or not one. */
  readonly width: number | null
  readonly height: number | null
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** `&amp;`, `&quot;`, `&#39;` and `&#x27;` become what they stand for; any other `&...;` stays. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,5}));/g,
    (all, dec, hex, name) => {
      if (typeof name === 'string') return NAMED[name] ?? all
      const code =
        typeof dec === 'string' ? Number.parseInt(dec, 10) : Number.parseInt(String(hex), 16)
      // Not a character a path or a label can hold (NUL, controls, lone surrogates, out of range).
      if (code < 32 || code === 127 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        return all
      return String.fromCodePoint(code)
    },
  )
}

/** A pixel size written as `300` or `300px`, or null. HTML takes whole numbers only. */
function pixels(value: string | undefined): number | null {
  if (value === undefined) return null
  const match = /^(\d{1,5})(?:px)?$/i.exec(value.trim())
  if (match === null) return null
  const size = Number.parseInt(match[1] ?? '', 10)
  return size >= 1 ? size : null
}

const NAME = /[^\s"'<>/=`]+/y
const UNQUOTED = /[^\s"'<>=`]+/y

/**
 * The attributes of `text` read as one `<img>` tag, by name (lower case, the first of a repeated
 * one), or null when `text` is anything but exactly one such tag on one line.
 */
function attributesOf(text: string): Map<string, string> | null {
  if (/[\r\n]/.test(text) || !/^<img(?=[\s/>])/i.test(text) || !text.endsWith('>')) return null
  const attributes = new Map<string, string>()
  const end = text.endsWith('/>') ? text.length - 2 : text.length - 1
  let at = 4
  while (at < end) {
    const space = /^\s*/.exec(text.slice(at, end))
    at += space?.[0].length ?? 0
    if (at >= end) break
    NAME.lastIndex = at
    const name = NAME.exec(text)
    if (name === null || at + name[0].length > end) return null
    at += name[0].length
    let value = ''
    const afterName = /^\s*=\s*/.exec(text.slice(at, end))
    if (afterName !== null) {
      at += afterName[0].length
      const quote = text[at]
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, at + 1)
        if (close < 0 || close >= end) return null
        value = text.slice(at + 1, close)
        at = close + 1
        // A quoted value must be followed by a gap or the end of the tag.
        if (at < end && !/\s/.test(text[at] ?? '')) return null
      } else {
        UNQUOTED.lastIndex = at
        const bare = UNQUOTED.exec(text)
        if (bare === null || at + bare[0].length > end) return null
        value = bare[0]
        at += value.length
      }
    }
    const key = name[0].toLowerCase()
    if (!attributes.has(key)) attributes.set(key, decodeEntities(value))
  }
  return attributes
}

/**
 * What `text` says as an image, or null when it is not exactly one `<img>` tag with a non-empty
 * `src` (then it stays source, like any other HTML).
 */
export function parseImgTag(text: string): ImgTag | null {
  const attributes = attributesOf(text.trim())
  if (attributes === null) return null
  const src = attributes.get('src')?.trim() ?? ''
  if (src === '') return null
  const title = attributes.get('title')
  return {
    src,
    alt: attributes.get('alt') ?? '',
    title: title === undefined || title === '' ? null : title,
    width: pixels(attributes.get('width')),
    height: pixels(attributes.get('height')),
  }
}
