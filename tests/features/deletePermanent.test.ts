// @vitest-environment jsdom
/**
 * Delete Permanently (P9.1-T52): `Shift+Delete` and the menu item ask a question of their own with
 * Cancel focused, and nothing is deleted before Yes (ISC-793). The delete shows the same dialog as a
 * delete to the bin (ISC-794). The test plays Rust where a delete has to stay open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { toasts } from '../helpers/toasts'
import { documentOfTab, followerOfTab, openPath, resetDocuments } from '@/documents/store'
import DeleteDialog from '@/features/tree/DeleteDialog.vue'
import DeleteProgressDialog from '@/features/tree/DeleteProgressDialog.vue'
import FileTree from '@/features/tree/FileTree.vue'
import {
  cancelDelete,
  DELETE_DIALOG_AFTER_MS,
  deletePaths,
  deletePrompt,
} from '@/features/tree/ops'
import { resetTree, restoreWorkspace, select, setSelection } from '@/features/tree/store'
import { setHost, type DeleteProgress, type DeleteReport } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { parseDeleteProgress } from '@/platform/workspace'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetWorkbench, tabsOfDocument } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const Harness = defineComponent({
  render: () => h('div', [h(FileTree), h(DeleteDialog), h(DeleteProgressDialog)]),
})

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined
let ends: (() => void)[] = []

beforeEach(async () => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  removeCommands = registerDefaultCommands()
  host = createMockHost({
    files: {
      '/work/notes/a.md': '# a\n',
      '/work/notes/b.md': '# b\n',
      '/work/one.md': '# one\n',
      '/work/two.md': '# two\n',
    },
    roots: ['/work'],
  })
  setHost(host)
  await restoreWorkspace(['/work/notes'])
  await flush()
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(Harness)
  app.mount(root)
  mounted = { app, root }
  await flush()
})

afterEach(async () => {
  for (const end of ends) end()
  ends = []
  cancelDelete()
  await flush()
  removeCommands?.()
  removeCommands = undefined
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
  setHost(undefined)
  resetTree()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const question = (): HTMLElement | null => document.body.querySelector('[data-delete-dialog]')
const asked = (): string => question()?.textContent.replace(/\s+/g, ' ').trim() ?? ''

function press(key: string, shiftKey = false): void {
  const tree = document.body.querySelector<HTMLElement>('[role=tree]')
  if (tree === null) throw new Error('no tree')
  tree.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
  )
}

async function yes(): Promise<void> {
  document.body.querySelector<HTMLElement>('[data-delete-confirm]')?.click()
  await flush()
}

const items = (): HTMLElement[] => [
  ...document.body.querySelectorAll<HTMLElement>('[role=menuitem]'),
]
const label = (item: HTMLElement): string => item.textContent.replace(/\s+/g, ' ').trim()

async function menuOf(path: string): Promise<string[]> {
  const row = document.body.querySelector<HTMLElement>(`[data-row-path="${path}"]`)
  if (row === null) throw new Error(`no row for ${path}`)
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  await flush()
  return items().map(label)
}

async function choose(start: string): Promise<void> {
  const item = items().find((candidate) => label(candidate).startsWith(start))
  if (item === undefined) throw new Error(`no item ${start}`)
  item.click()
  await flush()
}

function spies() {
  return {
    bin: vi.spyOn(host, 'deleteEntries'),
    permanent: vi.spyOn(host, 'deletePermanently'),
  }
}

describe('asking before a permanent delete (ISC-793)', () => {
  it('Shift+Delete asks its own question, with Cancel focused, and deletes nothing yet', async () => {
    select('/work/one.md')
    press('Delete', true)
    await flush()
    expect(asked()).toContain('Delete "one.md" permanently?')
    expect(asked()).toContain('This cannot be undone.')
    expect(asked()).not.toContain('moves to')
    expect(document.activeElement?.textContent.trim()).toBe('Cancel')
    const confirm = document.body.querySelector('[data-delete-confirm]')
    expect(confirm?.textContent.trim()).toBe('Delete Permanently')
    expect(host.files.has('/work/one.md')).toBe(true)
  })

  it('calls only the permanent delete, and only after Yes', async () => {
    const calls = spies()
    select('/work/one.md')
    press('Delete', true)
    await flush()
    expect(calls.permanent).not.toHaveBeenCalled()
    await yes()
    expect(calls.permanent).toHaveBeenCalledTimes(1)
    expect(calls.permanent.mock.calls[0]?.[0]).toEqual(['/work/one.md'])
    expect(calls.bin).not.toHaveBeenCalled()
    expect(host.files.has('/work/one.md')).toBe(false)
    expect(toasts.messages).toEqual([])
  })

  it('plain Delete still asks the bin question and calls only the bin delete', async () => {
    const calls = spies()
    select('/work/one.md')
    press('Delete')
    await flush()
    expect(asked()).toMatch(/The file moves to the (Recycle Bin|Trash)\./)
    expect(asked()).not.toContain('undone')
    await yes()
    expect(calls.bin).toHaveBeenCalledTimes(1)
    expect(calls.permanent).not.toHaveBeenCalled()
  })

  it('Cancel deletes nothing', async () => {
    const calls = spies()
    select('/work/one.md')
    press('Delete', true)
    await flush()
    ;(document.activeElement as HTMLElement).click()
    await flush()
    expect(deletePrompt.value).toBeNull()
    expect(calls.permanent).not.toHaveBeenCalled()
    expect(calls.bin).not.toHaveBeenCalled()
    expect(host.files.has('/work/one.md')).toBe(true)
  })

  it('the menu item asks the same question for one row', async () => {
    const calls = spies()
    const labels = await menuOf('/work/one.md')
    expect(labels).toContain('Delete Permanently Shift+Delete')
    await choose('Delete Permanently')
    expect(asked()).toContain('Delete "one.md" permanently?')
    expect(calls.permanent).not.toHaveBeenCalled()
  })

  it('says a folder takes everything in it, and what happens to its tabs', async () => {
    const a = await openPath('/work/notes/a.md')
    followerOfTab(a)?.dispatch({ changes: { from: 0, insert: 'x' } })
    select('/work/notes')
    press('Delete', true)
    await flush()
    expect(asked()).toContain('Delete the folder "notes" permanently?')
    expect(asked()).toContain('everything in it')
    expect(asked()).toContain('1 open tab closes.')
    expect(asked()).toContain('It has unsaved changes, and they are lost.')
  })

  it('asks once for several rows, by key and by menu', async () => {
    const calls = spies()
    const places = ['/work/one.md', '/work/two.md'].map((path) => ({ root: '/work', path }))
    setSelection(places)
    press('Delete', true)
    await flush()
    expect(asked()).toContain('Delete 2 items permanently?')
    expect(asked()).toContain('This cannot be undone.')
    cancelDelete()
    await flush()
    setSelection(places)
    await flush()
    const labels = await menuOf('/work/one.md')
    expect(labels).toContain('Delete 2 items Permanently Shift+Delete')
    await choose('Delete 2 items Permanently')
    expect(asked()).toContain('Delete 2 items permanently?')
    await yes()
    expect(calls.permanent.mock.calls[0]?.[0]).toEqual(['/work/one.md', '/work/two.md'])
    expect(calls.bin).not.toHaveBeenCalled()
  })

  it('has the host refuse a workspace folder, without asking', async () => {
    const calls = spies()
    select('/work')
    press('Delete', true)
    await flush()
    expect(question()).toBeNull()
    expect(calls.bin).not.toHaveBeenCalled()
    expect(toasts.last).toContain('Could not delete work')
    expect(host.files.has('/work/one.md')).toBe(true)
  })
})

describe('while a permanent delete runs (ISC-794)', () => {
  function holdPermanent() {
    let tell: (step: DeleteProgress) => void = () => undefined
    let end: (report: Partial<DeleteReport>) => void = () => undefined
    vi.spyOn(host, 'deletePermanently').mockImplementation((_paths, onProgress) => {
      tell = onProgress
      return new Promise<DeleteReport>((resolve) => {
        end = (report) => {
          resolve({ deleted: [], kept: [], destroyed: [], cancelled: false, ...report })
        }
      })
    })
    ends.push(() => {
      end({})
    })
    return {
      cancel: vi.spyOn(host, 'deleteCancel'),
      async tell(step: DeleteProgress): Promise<void> {
        tell(step)
        await flush()
      },
      async end(report: Partial<DeleteReport>): Promise<void> {
        end(report)
        await flush()
      },
    }
  }

  const part = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = document.body.querySelector<T>(`[data-delete-progress] ${selector}`)
    if (found === null) throw new Error(`the dialog has no ${selector}`)
    return found
  }

  async function shown() {
    const held = holdPermanent()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const done = deletePaths(['/work/notes'], true)
    for (let round = 0; round < 6; round++) {
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(DELETE_DIALOG_AFTER_MS)
    vi.useRealTimers()
    await flush()
    return { held, done }
  }

  it('shows the percent of what is gone, and Cancel still works', async () => {
    const { held, done } = await shown()
    await held.tell({ phase: 'removing', percent: 40 })
    expect(part('[data-delete-state]').textContent.trim()).toBe('Deleting permanently… 40%')
    expect(part('[role=progressbar]').getAttribute('aria-valuenow')).toBe('40')
    expect(part('[data-delete-bar]').style.width).toBe('40%')
    const cancel = part<HTMLButtonElement>('[data-delete-cancel]')
    expect(cancel.disabled).toBe(false)
    cancel.click()
    await flush()
    expect(held.cancel).toHaveBeenCalledTimes(1)
    expect(part('[data-delete-state]').textContent.trim()).toBe('Cancelling…')
    await held.end({ cancelled: true })
    await done
  })

  it('never says anything moves to the bin', async () => {
    const { held, done } = await shown()
    await held.tell({ phase: 'counting', percent: null })
    expect(document.body.querySelector('[data-delete-progress]')?.textContent).not.toMatch(
      /Recycle|Trash/,
    )
    await held.end({})
    await done
  })

  it('closes only the tabs of files that are gone from a folder that stayed', async () => {
    const a = await openPath('/work/notes/a.md')
    const b = await openPath('/work/notes/b.md')
    const ids = [a, b].map((tab) => documentOfTab(tab)?.id ?? -1)
    followerOfTab(b)?.dispatch({ changes: { from: 0, insert: 'kept ' } })
    vi.spyOn(host, 'deletePermanently').mockImplementation(() => {
      host.files.remove('/work/notes/a.md')
      return Promise.resolve({
        deleted: [],
        kept: [{ path: '/work/notes', reason: 'the delete was cancelled', cancelled: true }],
        destroyed: [],
        cancelled: true,
      })
    })
    await deletePaths(['/work/notes'], true)
    await flush()
    expect(ids.map((id) => tabsOfDocument(id).length)).toEqual([0, 1])
    expect(documentOfTab(b)?.dirty).toBe(true)
    expect(toasts.messages).toEqual([])
  })

  it('reads the new phase and refuses it without a figure', () => {
    expect(parseDeleteProgress({ phase: 'removing', percent: 3 })).toEqual({
      phase: 'removing',
      percent: 3,
    })
    expect(() => parseDeleteProgress({ phase: 'removing', percent: null })).toThrow('percent')
  })
})
