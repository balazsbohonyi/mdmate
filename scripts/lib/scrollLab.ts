/**
 * The files for the scroll-stability check: a long Markdown document with an image in every
 * section, and one PNG per image. Each image has its own file and its own size, so each loads for
 * the first time while the page is scrolled and nothing is remembered about it.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

export const SCROLL_LAB_IMAGES = 80

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  out.set(data, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** A PNG of `width` by `height` pixels, a diagonal gradient in a colour that depends on `seed`. */
export function gradientPng(width: number, height: number, seed: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour
  const rowBytes = 1 + width * 3
  const raw = Buffer.alloc(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes
    raw[row] = 0 // no filter
    for (let x = 0; x < width; x++) {
      const at = row + 1 + x * 3
      const t = (x + y) / (width + height)
      raw[at] = Math.round(40 + 180 * t * (((seed * 7) % 5) / 4 + 0.2)) & 0xff
      raw[at + 1] = Math.round(60 + 150 * (1 - t) * (((seed * 3) % 4) / 3 + 0.3)) & 0xff
      raw[at + 2] = (90 + ((seed * 37) % 120) + ((x >> 5) & 1) * 20) & 0xff
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The size of image `i`: from 320x140 up to about 880x640, never the same twice in a row. */
export function imageSize(i: number): { width: number; height: number } {
  return { width: 320 + ((i * 97) % 560), height: 140 + ((i * 61) % 500) }
}

const SENTENCE =
  'The quick survey of a **long section** keeps `inline code` and a [link](https://example.com) in view, so the lines around each figure look like a real document and never shrink to nothing.'

/** The document: a heading, two paragraphs and a figure per section, a badge row now and then. */
export function scrollLabDocument(count = SCROLL_LAB_IMAGES): string {
  const parts: string[] = ['# Scroll lab\n']
  for (let i = 0; i < count; i++) {
    const name = `img-${String(i).padStart(3, '0')}.png`
    parts.push(`## Section ${String(i)}\n`)
    parts.push(`${SENTENCE} ${SENTENCE}\n`)
    parts.push(`![Figure ${String(i)}](${name})\n`)
    parts.push(`${SENTENCE}\n`)
    if (i % 7 === 3) parts.push(`Status: ![badge](${name}) after figure ${String(i)}.\n`)
  }
  return parts.join('\n')
}

/** Writes the lab into `dir`, replacing what was there. Returns the document's path. */
export function writeScrollLab(dir: string, count = SCROLL_LAB_IMAGES): string {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < count; i++) {
    const { width, height } = imageSize(i)
    writeFileSync(join(dir, `img-${String(i).padStart(3, '0')}.png`), gradientPng(width, height, i))
  }
  const doc = join(dir, 'doc.md')
  writeFileSync(doc, scrollLabDocument(count))
  return doc
}
