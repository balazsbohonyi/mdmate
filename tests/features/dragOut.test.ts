// @vitest-environment jsdom
/**
 * P9.1-T10: a drag of tree rows that leaves the window is handed to the OS, which copies the rows
 * to wherever they are dropped. The page side only: the pointer leaving the window, what is
 * carried, what is left alone and what is said when the host refuses. The OLE drag itself is
 * checked in a real window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { toasts } from '../helpers/toasts'
import { resetDocuments } from '@/documents/store'
import { installFileDrop } from '@/features/drop'
import FileTree from '@/features/tree/FileTree.vue'
import { draggingOut } from '@/features/tree/ops'
import { resetTree, restoreWorkspace, select, toggleSelected } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/work/a.md': '# a\n',
  '/work/b.md': '# b\n',
  '/work/c.md': '# c\n',
  '/work/dest/x.md': '# x\n',
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined

async function start(): Promise<HTMLElement> {
  host = createMockHost({ files: FILES, roots: ['/work'] })
  setHost(host)
  await restoreWorkspace([])
  await flush()
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(FileTree)
  app.mount(root)
  mounted = { app, root }
  await flush()
  return root
}

beforeEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  draggingOut.value = false
  // jsdom has no layout, so no row is ever under the pointer.
  document.elementFromPoint = () => null
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'elementFromPoint')
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  setHost(undefined)
  resetTree()
  document.body.replaceChildren()
})

const rowEl = (root: HTMLElement, path: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`[data-row-path="${path}"]`)
  if (found === null) throw new Error(`no row ${path}`)
  return found
}
function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })
}
function press(root: HTMLElement, path: string): void {
  rowEl(root, path).dispatchEvent(pointer('pointerdown', 10, 10))
}

describe('a drag that leaves the window (P9.1-T10)', () => {
  it('hands the selected rows to the OS once the pointer is past the edge', async () => {
    const root = await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    await flush()
    press(root, '/work/a.md')
    window.dispatchEvent(pointer('pointermove', 40, 60))
    expect(host.draggedOut).toEqual([])
    window.dispatchEvent(pointer('pointermove', -3, 60))
    await flush()
    expect(host.draggedOut).toEqual([['/work/a.md', '/work/b.md']])
    // The drag in the page is over: the rows are where they were, and a release moves nothing.
    expect(root.querySelector('[data-dragging]')).toBeNull()
    window.dispatchEvent(pointer('pointerup', -3, 60))
    await flush()
    expect(host.files.has('/work/a.md')).toBe(true)
    expect(host.files.has('/work/b.md')).toBe(true)
    expect(host.draggedOut).toHaveLength(1)
  })

  it('goes past every edge, not only the left one', async () => {
    const root = await start()
    for (const [x, y] of [
      [40, -2],
      [window.innerWidth + 1, 60],
      [40, window.innerHeight + 1],
    ] as const) {
      host.draggedOut.length = 0
      draggingOut.value = false
      press(root, '/work/c.md')
      window.dispatchEvent(pointer('pointermove', 40, 60))
      window.dispatchEvent(pointer('pointermove', x, y))
      await flush()
      expect(host.draggedOut, `${String(x)},${String(y)}`).toEqual([['/work/c.md']])
    }
  })

  it('takes only the pressed row when it is not selected', async () => {
    const root = await start()
    select('/work/a.md', '/work')
    toggleSelected('/work/b.md', '/work')
    await flush()
    press(root, '/work/c.md')
    window.dispatchEvent(pointer('pointermove', 40, 60))
    window.dispatchEvent(pointer('pointermove', -3, 60))
    await flush()
    expect(host.draggedOut).toEqual([['/work/c.md']])
  })

  it('folds a row inside a selected folder into the folder', async () => {
    const root = await start()
    select('/work/dest', '/work')
    await flush()
    press(root, '/work/dest')
    window.dispatchEvent(pointer('pointermove', 40, 60))
    window.dispatchEvent(pointer('pointermove', -3, 60))
    await flush()
    expect(host.draggedOut).toEqual([['/work/dest']])
  })

  it('stays an ordinary drag while the pointer is inside the window', async () => {
    const root = await start()
    document.elementFromPoint = () => rowEl(root, '/work/dest')
    try {
      press(root, '/work/a.md')
      window.dispatchEvent(pointer('pointermove', 40, 60))
      await flush()
      window.dispatchEvent(pointer('pointerup', 40, 60))
      await flush()
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint')
    }
    expect(host.draggedOut).toEqual([])
    expect(host.files.has('/work/dest/a.md')).toBe(true)
  })

  it('does not start a second drag out while one is under way', async () => {
    const root = await start()
    let release: () => void = () => undefined
    let started = 0
    host.dragOut = () => {
      started++
      return new Promise<boolean>((resolve) => {
        release = () => resolve(true)
      })
    }
    press(root, '/work/a.md')
    window.dispatchEvent(pointer('pointermove', 40, 60))
    window.dispatchEvent(pointer('pointermove', -3, 60))
    await flush()
    expect(draggingOut.value).toBe(true)
    press(root, '/work/b.md')
    window.dispatchEvent(pointer('pointermove', 40, 60))
    window.dispatchEvent(pointer('pointermove', -3, 60))
    await flush()
    expect(started).toBe(1)
    release()
    await flush()
  })

  it('keeps ignoring drops for a moment after the drag ends, then listens again', async () => {
    const root = await start()
    vi.useFakeTimers()
    press(root, '/work/a.md')
    window.dispatchEvent(pointer('pointermove', 40, 60))
    window.dispatchEvent(pointer('pointermove', -3, 60))
    await vi.advanceTimersByTimeAsync(10)
    expect(draggingOut.value).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(draggingOut.value).toBe(false)
  })

  it('says so when the host refuses, and the rows stay', async () => {
    const root = await start()
    toasts.clear()
    host.dragOut = () => Promise.reject(new Error('access to /elsewhere is not allowed'))
    press(root, '/work/a.md')
    window.dispatchEvent(pointer('pointermove', 40, 60))
    window.dispatchEvent(pointer('pointermove', -3, 60))
    await flush()
    expect(toasts.last).toContain('Could not drag out')
    expect(host.files.has('/work/a.md')).toBe(true)
  })
})

describe('the mock host, like Rust, refuses the whole drag for a path outside the workspace', () => {
  it('refuses a path outside every root and an empty drag', async () => {
    await start()
    await expect(host.dragOut(['/work/a.md', '/elsewhere/o.md'])).rejects.toThrow()
    await expect(host.dragOut([])).rejects.toThrow()
    expect(host.draggedOut).toEqual([])
    await expect(host.dragOut(['/work/a.md'])).resolves.toBe(true)
  })
})

describe('a drop while a drag out is under way (P9.1-T10)', () => {
  it('is not a file dragged in from Explorer', async () => {
    await start()
    const stop = await installFileDrop()
    try {
      const seen: string[] = []
      const original = host.describeDrop.bind(host)
      host.describeDrop = (paths) => {
        seen.push(...paths)
        return original(paths)
      }
      draggingOut.value = true
      host.simulateDrop(['/work/a.md'], { x: 5, y: 5 })
      await flush()
      expect(seen).toEqual([])
    } finally {
      stop()
    }
  })
})
