import { isEndingCode, type EndingCode, type Endings } from '@/lib/endings'
import type { OpenedFile, ReadOnlyReason } from './host'

/**
 * The frame that carries a document between Rust and the page, in both directions, as raw bytes:
 *
 *     u32 LE   header length
 *     bytes    header, UTF-8 JSON
 *     0..3     zero bytes, so what follows starts on a 4-byte boundary
 *     u32 LE   pairs of (break index, ending code), `exceptions` of them
 *     bytes    the text, UTF-8, with `\n` as its only line break
 *
 * The header always holds `dominant` and `exceptions`. This is the page's half of
 * `src-tauri/src/fs/frame.rs` and must change with it.
 */

const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const textEncoder = new TextEncoder()

export interface Frame {
  readonly header: Readonly<Record<string, unknown>>
  readonly endings: Endings
  readonly text: string
}

function padding(offset: number): number {
  return (4 - (offset % 4)) % 4
}

export function encodeFrame(
  header: Readonly<Record<string, unknown>>,
  endings: Endings,
  text: string,
): Uint8Array<ArrayBuffer> {
  const headerBytes = textEncoder.encode(
    JSON.stringify({
      ...header,
      dominant: endings.dominant,
      exceptions: endings.at.length,
    }),
  )
  const textBytes = textEncoder.encode(text)
  const headerEnd = 4 + headerBytes.length
  const pairsStart = headerEnd + padding(headerEnd)
  const pairsEnd = pairsStart + endings.at.length * 8
  const out = new Uint8Array(pairsEnd + textBytes.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, headerBytes.length, true)
  out.set(headerBytes, 4)
  endings.at.forEach((index, i) => {
    view.setUint32(pairsStart + i * 8, index, true)
    view.setUint32(pairsStart + i * 8 + 4, endings.codes[i] ?? 0, true)
  })
  out.set(textBytes, pairsEnd)
  return out
}

function bad(what: string): Error {
  return new Error(`Bad document frame: ${what}`)
}

/** Takes a frame apart, refusing anything cut short, misaligned or inconsistent. */
export function decodeFrame(buffer: ArrayBuffer): Frame {
  const view = new DataView(buffer)
  if (buffer.byteLength < 4) throw bad('no length')
  const headerLength = view.getUint32(0, true)
  const headerEnd = 4 + headerLength
  if (headerEnd > buffer.byteLength) throw bad('header cut short')
  let parsed: unknown
  try {
    parsed = JSON.parse(textDecoder.decode(new Uint8Array(buffer, 4, headerLength)))
  } catch {
    throw bad('header is not JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw bad('header is not an object')
  }
  const header: Record<string, unknown> = { ...parsed }
  const dominant = header.dominant
  const count = header.exceptions
  if (typeof dominant !== 'number' || !isEndingCode(dominant)) throw bad('no dominant ending')
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw bad('no exception count')
  }

  const pairsStart = headerEnd + padding(headerEnd)
  const pairsEnd = pairsStart + count * 8
  if (pairsEnd > buffer.byteLength) throw bad('exceptions cut short')
  const at: number[] = []
  const codes: EndingCode[] = []
  for (let i = 0; i < count; i++) {
    const code = view.getUint32(pairsStart + i * 8 + 4, true)
    if (!isEndingCode(code)) throw bad('unknown ending code')
    at.push(view.getUint32(pairsStart + i * 8, true))
    codes.push(code)
  }
  let text: string
  try {
    text = textDecoder.decode(new Uint8Array(buffer, pairsEnd))
  } catch {
    throw bad('text is not UTF-8')
  }
  return { header, endings: { dominant, at, codes }, text }
}

function field<T>(header: Readonly<Record<string, unknown>>, key: string, type: string): T {
  const value = header[key]
  if (typeof value !== type) throw bad(`header field "${key}" is not a ${type}`)
  return value as T // checked by typeof just above
}

const ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'unsupported'] as const
const READ_ONLY: readonly string[] = ['unsupported-encoding', 'not-round-trippable']

/** Reads the frame Rust sends for `open_file` into an `OpenedFile`. */
export function openedFromFrame(frame: Frame): OpenedFile {
  const { header } = frame
  const encoding = field<string>(header, 'encoding', 'string')
  const found = ENCODINGS.find((name) => name === encoding)
  if (found === undefined) throw bad(`unknown encoding "${encoding}"`)
  const readOnly = header.readOnly
  if (readOnly !== null && (typeof readOnly !== 'string' || !READ_ONLY.includes(readOnly))) {
    throw bad('bad readOnly field')
  }
  return {
    id: field<number>(header, 'id', 'number'),
    path: field<string>(header, 'path', 'string'),
    name: field<string>(header, 'name', 'string'),
    encoding: found,
    bom: field<boolean>(header, 'bom', 'boolean'),
    readOnly: readOnly as ReadOnlyReason | null, // checked against the two names just above
    size: field<number>(header, 'size', 'number'),
    hash: field<string>(header, 'hash', 'string'),
    text: frame.text,
    endings: frame.endings,
  }
}
