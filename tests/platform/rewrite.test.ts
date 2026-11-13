import { describe, expect, it } from 'vitest'
import { parseLinksOnRename } from '@/platform/rewrite'

describe('parseLinksOnRename (the answer of links_on_rename_override, ISC-319)', () => {
  it('passes the three values through', () => {
    expect(parseLinksOnRename('ask')).toBe('ask')
    expect(parseLinksOnRename('update')).toBe('update')
    expect(parseLinksOnRename('never')).toBe('never')
  })

  it('reads nothing as null, so the setting stays what it was', () => {
    expect(parseLinksOnRename(null)).toBeNull()
    expect(parseLinksOnRename(undefined)).toBeNull()
  })

  it('refuses anything else, since Rust only ever sends one of the three', () => {
    expect(() => parseLinksOnRename('always')).toThrow('not a setting value')
    expect(() => parseLinksOnRename(1)).toThrow()
  })
})
