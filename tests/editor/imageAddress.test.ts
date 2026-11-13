/**
 * ISC-333: what a link in an untitled document may load. Its folder is its draft folder, and the
 * allowlist is the one every document has: a link that leaves that folder never resolves, so one
 * tab cannot show another tab's draft images, and an absolute path to a draft folder is refused
 * (any scheme, a drive letter, a leading slash).
 */
import { describe, expect, it } from 'vitest'
import { resolveImageAddress } from '@/editor/livePreview/blocks'

const DRAFT_2 = 'C:\\Users\\me\\AppData\\Roaming\\mdmate\\drafts\\2'

describe('image links in an untitled document (draft folder as its folder)', () => {
  it('loads an image in its own draft folder', () => {
    expect(resolveImageAddress('assets/image-20261113-153000.png', DRAFT_2)).toEqual({
      kind: 'local',
      path: `${DRAFT_2}\\assets\\image-20261113-153000.png`,
    })
    expect(resolveImageAddress('./assets/a.png', DRAFT_2)).toMatchObject({ kind: 'local' })
  })

  it('refuses a link that leaves the draft folder, including into another draft', () => {
    for (const link of [
      '../1/assets/a.png',
      '../../drafts/1/assets/a.png',
      'assets/../../1/assets/a.png',
      'assets/%2e%2e/%2e%2e/1/a.png',
    ]) {
      expect(resolveImageAddress(link, DRAFT_2), link).toEqual({ kind: 'refused' })
    }
  })

  it('refuses an absolute path or a file address to any draft folder', () => {
    const other = 'C:\\Users\\me\\AppData\\Roaming\\mdmate\\drafts\\1\\assets\\a.png'
    const slashed = other.replaceAll('\\', '/')
    for (const link of [
      other,
      slashed,
      `file:///${slashed}`,
      '/drafts/1/assets/a.png',
      '\\\\server\\share\\a.png',
    ]) {
      expect(resolveImageAddress(link, DRAFT_2), link).toEqual({ kind: 'refused' })
    }
  })

  it('refuses every relative link when there is no draft folder to be in', () => {
    expect(resolveImageAddress('assets/a.png', null)).toEqual({ kind: 'refused' })
  })
})
