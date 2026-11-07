import { describe, expect, it } from 'vitest'
import { CR, CRLF, LF, uniformEndings } from '@/lib/endings'
import { decodeFrame, encodeFrame, openedFromFrame } from '@/platform/frame'

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** The frame the Rust test `the_bytes_match_what_the_page_expects` builds. Keep the two in step. */
function pinnedFrame(): Uint8Array {
  const header = new TextEncoder().encode('{"dominant":1,"exceptions":1,"name":"a.md"}')
  const out = [
    43,
    0,
    0,
    0,
    ...header,
    0,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...new TextEncoder().encode('x\ny'),
  ]
  return Uint8Array.from(out)
}

describe('the document frame', () => {
  it('reads the bytes Rust writes for the same document', () => {
    const frame = decodeFrame(bufferOf(pinnedFrame()))
    expect(frame.header.name).toBe('a.md')
    expect(frame.endings).toEqual({ dominant: CRLF, at: [1], codes: [LF] })
    expect(frame.text).toBe('x\ny')
  })

  it('writes the same bytes as Rust for that document', () => {
    const bytes = encodeFrame({ name: 'a.md' }, { dominant: CRLF, at: [1], codes: [LF] }, 'x\ny')
    // Key order differs between serde_json and JSON.stringify only in the header, so compare the
    // parts: the header as data, and everything after it as bytes.
    const view = new DataView(bytes.buffer)
    const headerLength = view.getUint32(0, true)
    const header: unknown = JSON.parse(
      new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)),
    )
    expect(header).toEqual({ name: 'a.md', dominant: 1, exceptions: 1 })
    expect([...bytes.subarray(4 + headerLength)]).toEqual([...pinnedFrame().subarray(47)])
  })

  it('brings text and endings back as they went, whatever the header length', () => {
    for (const name of ['', 'a', 'ab', 'abc', 'abcd', 'caf\u00e9', '\u{1F600}']) {
      const endings = { dominant: CRLF, at: [0, 3], codes: [LF, CR] } as const
      const text = 'a\nb\nc\n\u{1F600}\nz'
      const frame = decodeFrame(bufferOf(encodeFrame({ name }, endings, text)))
      expect(frame.header.name).toBe(name)
      expect(frame.endings).toEqual(endings)
      expect(frame.text).toBe(text)
    }
  })

  it('keeps a byte order mark that is part of the text', () => {
    const frame = decodeFrame(bufferOf(encodeFrame({}, uniformEndings(), '\uFEFFhello')))
    expect(frame.text).toBe('\uFEFFhello')
  })

  it('takes empty text and no exceptions', () => {
    const frame = decodeFrame(bufferOf(encodeFrame({}, uniformEndings(CR), '')))
    expect(frame.text).toBe('')
    expect(frame.endings).toEqual({ dominant: CR, at: [], codes: [] })
  })

  it('refuses frames that are cut short, lying or not UTF-8', () => {
    const good = encodeFrame({}, { dominant: LF, at: [0], codes: [CRLF] }, 'a\nb')
    expect(() => decodeFrame(bufferOf(good.subarray(0, 2)))).toThrow(/Bad document frame/)
    expect(() => decodeFrame(bufferOf(good.subarray(0, 10)))).toThrow(/Bad document frame/)

    const noPairs = good.slice()
    // Chop the frame inside the exception pairs.
    const headerLength = new DataView(noPairs.buffer).getUint32(0, true)
    const pairsAt = 4 + headerLength + ((4 - ((4 + headerLength) % 4)) % 4)
    expect(() => decodeFrame(bufferOf(noPairs.subarray(0, pairsAt + 4)))).toThrow(/cut short/)

    const badCode = good.slice()
    new DataView(badCode.buffer).setUint32(pairsAt + 4, 7, true)
    expect(() => decodeFrame(bufferOf(badCode))).toThrow(/unknown ending/)

    const badText = Uint8Array.from([...good, 0xff])
    expect(() => decodeFrame(bufferOf(badText))).toThrow(/not UTF-8/)
  })
})

describe('an opened file', () => {
  const header = {
    id: 7,
    path: 'C:/notes/a.md',
    name: 'a.md',
    encoding: 'utf-16le',
    bom: true,
    readOnly: null,
    size: 12,
    hash: 'f'.repeat(32),
  }

  it('is read from the open frame', () => {
    const frame = decodeFrame(bufferOf(encodeFrame(header, uniformEndings(CRLF), 'hi')))
    expect(openedFromFrame(frame)).toEqual({
      ...header,
      text: 'hi',
      endings: { dominant: CRLF, at: [], codes: [] },
    })
  })

  it('refuses a header with a missing or unknown field', () => {
    const decode = (extra: Record<string, unknown>) =>
      openedFromFrame(
        decodeFrame(bufferOf(encodeFrame({ ...header, ...extra }, uniformEndings(), ''))),
      )
    expect(() => decode({ encoding: 'ebcdic' })).toThrow(/unknown encoding/)
    expect(() => decode({ readOnly: 'because' })).toThrow(/readOnly/)
    expect(() => decode({ id: 'seven' })).toThrow(/"id"/)
    expect(decode({ readOnly: 'not-round-trippable' }).readOnly).toBe('not-round-trippable')
  })
})
