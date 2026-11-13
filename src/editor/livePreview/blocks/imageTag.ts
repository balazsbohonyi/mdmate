/**
 * Reading an `<img>` tag the owner wrote (or a resize wrote) into the document. A Markdown file
 * is untrusted text, so this is an allowlist twice over: only a tag that is exactly one `<img ...>`
 * on one line is read, and of its attributes only `src`, `alt`, `title`, `width` and `height` are
 * kept. Nothing else survives to the page: no `style`, no `on*` handler, no `srcset`, no `class`.
 * The address still goes through the same allowlist as a Markdown image (`resolveImageAddress`).
 */

/** One change to a text: replace `[from, to)` with `insert`. */
export interface TextEdit {
  readonly from: number
  readonly to: number
  readonly insert: string
}

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

/** Where one attribute sits in the scanned text. */
export interface AttributeSpan {
  /** Lower case. */
  readonly name: string
  /** The start of the name. */
  readonly from: number
  /** The end of the attribute, after a closing quote. */
  readonly to: number
  /** The value's text, inside any quotes, or -1 for an attribute written without a value. */
  readonly valueFrom: number
  readonly valueTo: number
  readonly quoted: boolean
}

interface TagScan {
  /** By name (lower case), the first of a repeated one, entities read. */
  readonly attributes: Map<string, string>
  /** Every attribute in the order written, repeated ones too. */
  readonly spans: AttributeSpan[]
}

/** `text` read as one `<img>` tag on one line, or null when it is anything else. */
function scanTag(text: string): TagScan | null {
  if (/[\r\n]/.test(text) || !/^<img(?=[\s/>])/i.test(text) || !text.endsWith('>')) return null
  const attributes = new Map<string, string>()
  const spans: AttributeSpan[] = []
  const end = text.endsWith('/>') ? text.length - 2 : text.length - 1
  let at = 4
  while (at < end) {
    const space = /^\s*/.exec(text.slice(at, end))
    at += space?.[0].length ?? 0
    if (at >= end) break
    NAME.lastIndex = at
    const name = NAME.exec(text)
    if (name === null || at + name[0].length > end) return null
    const from = at
    at += name[0].length
    let value = ''
    let valueFrom = -1
    let valueTo = -1
    let quoted = false
    const afterName = /^\s*=\s*/.exec(text.slice(at, end))
    if (afterName !== null) {
      at += afterName[0].length
      const quote = text[at]
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, at + 1)
        if (close < 0 || close >= end) return null
        value = text.slice(at + 1, close)
        quoted = true
        valueFrom = at + 1
        valueTo = close
        at = close + 1
        // A quoted value must be followed by a gap or the end of the tag.
        if (at < end && !/\s/.test(text[at] ?? '')) return null
      } else {
        UNQUOTED.lastIndex = at
        const bare = UNQUOTED.exec(text)
        if (bare === null || at + bare[0].length > end) return null
        value = bare[0]
        valueFrom = at
        valueTo = at + value.length
        at = valueTo
      }
    }
    const key = name[0].toLowerCase()
    spans.push({ name: key, from, to: at, valueFrom, valueTo, quoted })
    if (!attributes.has(key)) attributes.set(key, decodeEntities(value))
  }
  return { attributes, spans }
}

/**
 * The edits (offsets in `source`) that make an `<img>` tag `width` pixels wide and nothing else
 * but drop its `height`, which would otherwise stretch the picture. The first `width` is the one
 * a browser reads, so that is the one set (its quotes stay); a tag with none gets ` width="N"`
 * after its last attribute; every `height` goes, with the gap before it. Null when `source` is not
 * an `<img>` tag this reader accepts; empty when the tag already says exactly that.
 */
export function widthEdits(source: string, width: number): TextEdit[] | null {
  const lead = source.length - source.trimStart().length
  const scan = scanTag(source.trim())
  if (scan === null) return null
  const edits: TextEdit[] = []
  const first = scan.spans.find((span) => span.name === 'width')
  const kept = scan.spans.filter((span) => span.name !== 'height')
  const last = kept[kept.length - 1]
  if (first === undefined) {
    if (last === undefined) return null
    edits.push({ from: lead + last.to, to: lead + last.to, insert: ` width="${String(width)}"` })
  } else if (first.quoted) {
    if (source.slice(lead + first.valueFrom, lead + first.valueTo) !== String(width)) {
      edits.push({ from: lead + first.valueFrom, to: lead + first.valueTo, insert: String(width) })
    }
  } else {
    edits.push({ from: lead + first.from, to: lead + first.to, insert: `width="${String(width)}"` })
  }
  const text = source.trim()
  for (const span of scan.spans) {
    if (span.name !== 'height') continue
    let from = span.from
    while (from > 0 && /\s/.test(text[from - 1] ?? '')) from--
    edits.push({ from: lead + from, to: lead + span.to, insert: '' })
  }
  return edits.sort((a, b) => a.from - b.from)
}

/**
 * What `text` says as an image, or null when it is not exactly one `<img>` tag with a non-empty
 * `src` (then it stays source, like any other HTML).
 */
export function parseImgTag(text: string): ImgTag | null {
  const scan = scanTag(text.trim())
  if (scan === null) return null
  const attributes = scan.attributes
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
