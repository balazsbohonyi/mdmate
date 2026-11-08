import { describe, expect, it } from 'vitest'
import { parseFollowedLink, parseLinkInfo } from '@/platform/links'
import { createMockHost } from '@/platform/mock'

describe('parseLinkInfo', () => {
  it('accepts every kind Rust sends', () => {
    expect(parseLinkInfo({ kind: 'anchor', fragment: 'Intro' })).toEqual({
      kind: 'anchor',
      fragment: 'Intro',
    })
    expect(parseLinkInfo({ kind: 'web', url: 'https://example.com' }).kind).toBe('web')
    expect(parseLinkInfo({ kind: 'markdown', path: 'C:\\a.md', fragment: null })).toEqual({
      kind: 'markdown',
      path: 'C:\\a.md',
      fragment: null,
    })
    for (const kind of ['image', 'file', 'missing']) {
      expect(parseLinkInfo({ kind, path: 'x' }).kind).toBe(kind)
    }
    expect(parseLinkInfo({ kind: 'refused', reason: 'network' })).toEqual({
      kind: 'refused',
      reason: 'network',
    })
  })

  it('rejects anything else', () => {
    for (const bad of [
      null,
      'web',
      { kind: 'open-anything', url: 'x' },
      { kind: 'web' },
      { kind: 'web', url: 1 },
      { kind: 'refused', reason: 'because' },
      { kind: 'markdown', path: 'a.md', fragment: 3 },
    ]) {
      expect(() => parseLinkInfo(bad), JSON.stringify(bad)).toThrow()
    }
  })
})

describe('parseFollowedLink', () => {
  it('accepts the three results and rejects others', () => {
    expect(parseFollowedLink({ kind: 'opened' })).toEqual({ kind: 'opened' })
    expect(parseFollowedLink({ kind: 'anchor', fragment: 'x' }).kind).toBe('anchor')
    expect(parseFollowedLink({ kind: 'document', path: 'a.md', fragment: 'x' }).kind).toBe(
      'document',
    )
    expect(() => parseFollowedLink({ kind: 'launched' })).toThrow()
    expect(() => parseFollowedLink({ kind: 'document' })).toThrow()
  })
})

describe('mock host links', () => {
  async function opened() {
    const host = createMockHost({
      files: { '/d/a.md': '[b](b.md)', '/d/b.md': '# B', '/d/spec.pdf': '%PDF', '/d/pic.png': 'x' },
    })
    const doc = await host.openFile('/d/a.md')
    return { host, id: doc.id }
  }

  it('describes each kind relative to the document', async () => {
    const { host, id } = await opened()
    expect(await host.describeLink(id, 'b.md#Top')).toEqual({
      kind: 'markdown',
      path: '/d/b.md',
      fragment: 'Top',
    })
    expect((await host.describeLink(id, 'gone.md')).kind).toBe('missing')
    expect((await host.describeLink(id, 'spec.pdf')).kind).toBe('file')
    expect((await host.describeLink(id, 'javascript:alert(1)')).kind).toBe('refused')
    expect((await host.describeLink(id, '//host/share')).kind).toBe('refused')
  })

  it('opens only after a confirmation for other files, and records what it opened', async () => {
    const { host, id } = await opened()
    await expect(host.followLink(id, 'spec.pdf', false)).rejects.toMatchObject({
      kind: 'needs-confirmation',
    })
    expect(host.opened).toEqual([])
    expect(await host.followLink(id, 'spec.pdf', true)).toEqual({ kind: 'opened' })
    expect(await host.followLink(id, 'https://example.com', false)).toEqual({ kind: 'opened' })
    await expect(host.followLink(id, 'vbscript:x', true)).rejects.toMatchObject({
      kind: 'link-refused',
    })
    expect(host.opened).toEqual(['/d/spec.pdf', 'https://example.com'])
  })
})
