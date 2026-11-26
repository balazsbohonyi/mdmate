// @vitest-environment jsdom
// ISC-757 and ISC-758: a link that names a line, followed from the page, against the browser stand-in
// for the host. The guard's own rules are in Rust (`line_suffix`, `line_suffix_refusals`).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { followLinkFrom, pendingLink } from '@/documents/links'
import { documentOfTab, followerOfTab, openInActivePane, resetDocuments } from '@/documents/store'
import { isLocalTarget } from '@/editor/brokenLinks'
import { columnAt } from '@/editor/goToLine'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { findPane } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

const lines = (count: number): string =>
  Array.from({ length: count }, (_, at) => `const value${String(at + 1)} = ${String(at + 1)}`).join(
    '\n',
  )

const FILES: Record<string, string> = {
  '/work/report.md': '# report\n',
  '/work/calculations.ts': lines(60),
  '/work/src/calculations.ts': lines(60),
  '/work/with.md': 'one\ntwo\nthree\nfour\nfive\n\n## L5\n\ntext\n',
  '/work/without.md': 'one\ntwo\nthree\nfour\nfive\nsix\n',
}

let host: MockHost

beforeEach(() => {
  resetDocuments()
  resetWorkbench()
  host = createMockHost({ files: FILES })
  setHost(host)
})

afterEach(() => {
  pendingLink.value = null
  setHost(undefined)
})

/** Follows `href` from the report and says where the caret ended: `name line:column`. */
async function follow(href: string): Promise<string> {
  const from = await openInActivePane('/work/report.md')
  await followLinkFrom(from, href)
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab ?? ''
  const state = followerOfTab(tab)!.state
  const head = state.selection.main.head
  const line = state.doc.lineAt(head).number
  return `${documentOfTab(tab)!.name} ${String(line)}:${String(columnAt(state.doc, head))}`
}

describe('a link with a line opens its file there (ISC-757)', () => {
  it.each([
    ['calculations.ts:48', 'calculations.ts 48:1'],
    ['calculations.ts:48:7', 'calculations.ts 48:7'],
    ['calculations.ts#L12', 'calculations.ts 12:1'],
    ['calculations.ts#L12-L20', 'calculations.ts 12:1'],
    ['src/calculations.ts:53', 'calculations.ts 53:1'],
    ['./src/calculations.ts#L3', 'calculations.ts 3:1'],
    ['calculations.ts:999', 'calculations.ts 60:1'],
    ['without.md:4', 'without.md 4:1'],
  ])('%s', async (href, expected) => {
    expect(await follow(href)).toBe(expected)
    expect(pendingLink.value).toBeNull()
    expect(host.opened).toEqual([])
  })

  it('moves an open file to the line, too', async () => {
    await openInActivePane('/work/calculations.ts')
    expect(await follow('calculations.ts:30')).toBe('calculations.ts 30:1')
  })

  it('still asks before a file without a line opens in its default app', async () => {
    await follow('calculations.ts')
    expect(pendingLink.value?.path).toBe('/work/calculations.ts')
  })

  it.each(['calculations.ts:48', 'src/calculations.ts#L3', 'calculations.ts:48:7'])(
    'is checked for a missing file: %s',
    async (href) => {
      expect(isLocalTarget(href)).toBe(true)
      const tab = await openInActivePane('/work/report.md')
      const id = documentOfTab(tab)!.id
      expect(await host.checkLinks(id, [href, `gone/${href}`])).toEqual([false, true])
    },
  )

  it.each(['tel:123', 'C:12', 'file.md:stream', 'https://example.com:8080', 'javascript:1'])(
    'takes %s for no file of the folder',
    (href) => {
      expect(isLocalTarget(href)).toBe(false)
    },
  )
})

describe('a heading wins over the line form in Markdown (ISC-758)', () => {
  it('goes to the heading named #l5 where there is one', async () => {
    expect(await follow('with.md#l5')).toBe('with.md 7:1')
  })

  it('goes to line 5 where there is none', async () => {
    expect(await follow('without.md#l5')).toBe('without.md 5:1')
  })
})
