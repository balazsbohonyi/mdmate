// @vitest-environment jsdom
/**
 * ISC-240: while a row of the tree is dragged, the cursor says where it can land: a closed hand over
 * a folder it may move into, a "not allowed" sign over anywhere else (its own folder, itself, the
 * editor, empty space), and the normal cursor again when the drag ends by a drop or by Escape.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { resetDocuments } from '@/documents/store'
import FileTree from '@/features/tree/FileTree.vue'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await settle()
    await nextTick()
  }
}

let mounted: { app: App; root: HTMLElement } | undefined

beforeEach(async () => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  setHost(
    createMockHost({
      files: { '/work/a.md': '# a\n', '/work/sub/b.md': '# b\n', '/work/other/c.md': '# c\n' },
      roots: ['/work'],
    }),
  )
  await restoreWorkspace(['/work'])
  await flush()
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(FileTree)
  app.mount(root)
  mounted = { app, root }
  await flush()
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  // jsdom has no such method; the test adds one.
  Reflect.deleteProperty(document, 'elementFromPoint')
  document.documentElement.removeAttribute('data-tree-drag')
  document.body.replaceChildren()
  setHost(undefined)
  resetTree()
})

const row = (path: string): HTMLElement => {
  const found = document.body.querySelector<HTMLElement>(`[data-row-path="${path}"]`)
  if (found === null) throw new Error(`no row for ${path}`)
  return found
}
const cursor = (): string | null => document.documentElement.getAttribute('data-tree-drag')

function press(path: string): void {
  row(path).dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 60, clientY: 80 }),
  )
}
function moveOver(target: Element | null, x = 200): void {
  Object.assign(document, { elementFromPoint: () => target })
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: 80 }))
}

describe('the cursor of a tree drag (ISC-240)', () => {
  it('shows nothing before the pointer has moved far enough to start a drag', () => {
    press('/work/a.md')
    moveOver(row('/work/sub'), 62)
    expect(cursor()).toBeNull()
  })

  it('is a closed hand over a folder the row may move into', () => {
    press('/work/a.md')
    moveOver(row('/work/sub'))
    expect(cursor()).toBe('move')
  })

  it('is a not-allowed sign over itself, its own parent folder, empty space and the editor', () => {
    press('/work/sub')
    moveOver(row('/work/sub'))
    expect(cursor()).toBe('blocked')
    moveOver(row('/work'))
    expect(cursor()).toBe('blocked')
    moveOver(null)
    expect(cursor()).toBe('blocked')
    moveOver(document.body)
    expect(cursor()).toBe('blocked')
    moveOver(row('/work/other'))
    expect(cursor()).toBe('move')
  })

  it('goes back to the normal cursor on a drop and on Escape', () => {
    press('/work/a.md')
    moveOver(row('/work/sub'))
    window.dispatchEvent(new PointerEvent('pointerup'))
    expect(cursor()).toBeNull()
    press('/work/a.md')
    moveOver(row('/work/other'))
    expect(cursor()).toBe('move')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(cursor()).toBeNull()
  })

  it('turns the attribute into cursors on every element, with !important', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    expect(css).toMatch(
      /html\[data-tree-drag='move'\][^{]*\*\s*\{[^}]*cursor:\s*grabbing\s*!important/s,
    )
    expect(css).toMatch(
      /html\[data-tree-drag='blocked'\][^{]*\*\s*\{[^}]*cursor:\s*not-allowed\s*!important/s,
    )
  })
})
