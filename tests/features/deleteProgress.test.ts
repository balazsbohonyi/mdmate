// @vitest-environment jsdom
/**
 * The progress of a delete that takes long (P9.1-T51): one operation for a selection (ISC-786), the
 * dialog after two seconds (ISC-787) and what it shows (ISC-788), the app held back behind it
 * (ISC-789), what the tabs and the tree become when it ends (ISC-790), and a window close during one
 * (ISC-791). The host's delete is held open here, so the test plays Rust.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { startJournal, stopJournal } from '@/documents/session'
import { documentOfTab, followerOfTab, openPath, resetDocuments } from '@/documents/store'
import DeleteProgressDialog from '@/features/tree/DeleteProgressDialog.vue'
import {
  cancelRunningDelete,
  confirmDelete,
  DELETE_DIALOG_AFTER_MS,
  deletePaths,
  deleteRun,
  requestDeleteMany,
} from '@/features/tree/ops'
import { resetTree, restoreWorkspace, treeRows } from '@/features/tree/store'
import { setHost, type DeleteProgress, type DeleteReport } from '@/platform'
import { createMockHost, type MockHost } from '@/platform/mock'
import { parseDeleteProgress, parseDeleteReport } from '@/platform/workspace'
import { registerCommand } from '@/workbench/commands'
import { installKeybindings } from '@/workbench/keyboard'
import { resetWorkbench, tabsOfDocument } from '@/workbench/store'
import { toasts } from '../helpers/toasts'

const FILES: Record<string, string> = {
  '/work/big/a.md': '# a\n',
  '/work/big/b.md': '# b\n',
  '/work/one.md': '# one\n',
  '/work/two.md': '# two\n',
}

const NOTHING: DeleteReport = { deleted: [], kept: [], destroyed: [], cancelled: false }

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
let cleanups: (() => void)[] = []

/** Lets pending promises, timers of zero length and Vue's updates run. */
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

/** Takes the host's delete over: it stays open until the test ends it. */
function holdDelete() {
  const asked: string[][] = []
  let tell: (step: DeleteProgress) => void = () => undefined
  let end: (report: DeleteReport) => void = () => undefined
  let fail: (error: Error) => void = () => undefined
  vi.spyOn(host, 'deleteEntries').mockImplementation((paths, onProgress) => {
    asked.push([...paths])
    tell = onProgress
    return new Promise<DeleteReport>((resolve, reject) => {
      end = resolve
      fail = reject
    })
  })
  const cancel = vi.spyOn(host, 'deleteCancel')
  // A test that fails must not leave its delete running for the next one.
  cleanups.push(() => {
    end(NOTHING)
  })
  return {
    asked,
    cancel,
    async tell(step: DeleteProgress): Promise<void> {
      tell(step)
      await flush()
    },
    async end(report: Partial<DeleteReport> = {}): Promise<void> {
      end({ ...NOTHING, ...report })
      await flush()
    },
    async fail(message: string): Promise<void> {
      fail(new Error(message))
      await flush()
    },
  }
}

function mountDialog(): void {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(DeleteProgressDialog)
  app.mount(root)
  mounted = { app, root }
}

/** Lets a delete run long enough to be shown. */
async function wait(ms: number = DELETE_DIALOG_AFTER_MS): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await flush()
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[data-delete-progress]')
}

function part<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = dialog()?.querySelector<T>(selector)
  if (!found) throw new Error(`the dialog has no ${selector}`)
  return found
}

const cancelButton = (): HTMLButtonElement => part<HTMLButtonElement>('[data-delete-cancel]')
const bar = (): HTMLElement => part('[role="progressbar"]')
const state = (): string => part('[data-delete-state]').textContent.trim()

const names = (): string[] => treeRows.value.map((row) => row.name)

/** Opens a file and types into it, so its tab holds unsaved edits. */
async function edited(path: string): Promise<{ tab: string; id: number }> {
  const tab = await openPath(path)
  followerOfTab(tab)?.dispatch({ changes: { from: 0, insert: 'edited ' } })
  await flush()
  const doc = documentOfTab(tab)
  if (doc === undefined) throw new Error('not open')
  return { tab, id: doc.id }
}

const isOpen = (id: number): boolean => tabsOfDocument(id).length > 0

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  resetTree()
  resetDocuments()
  resetWorkbench()
  host = createMockHost({ files: FILES, roots: ['/work'] })
  setHost(host)
  await restoreWorkspace(['/work/big'])
  await flush()
})

afterEach(async () => {
  stopJournal()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  for (const clean of cleanups) clean()
  cleanups = []
  await flush()
  await vi.runOnlyPendingTimersAsync()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setHost(undefined)
  resetTree()
  document.body.innerHTML = ''
})

describe('one delete for a selection (ISC-786)', () => {
  it('hands every selected path to the host in one call', async () => {
    const held = holdDelete()
    requestDeleteMany(['/work/big', '/work/one.md'])
    const done = confirmDelete()
    await flush()
    expect(held.asked).toEqual([['/work/big', '/work/one.md']])
    await held.end()
    await done
  })

  it('starts no second delete while one runs', async () => {
    const held = holdDelete()
    const first = deletePaths(['/work/big'])
    await flush()
    await deletePaths(['/work/one.md'])
    expect(held.asked).toHaveLength(1)
    expect(toasts.last).toContain('still running')
    await held.end()
    await first
  })
})

describe('when the dialog shows (ISC-787)', () => {
  it('shows nothing for a delete that ends within two seconds', async () => {
    const held = holdDelete()
    mountDialog()
    const done = deletePaths(['/work/big'])
    await wait(DELETE_DIALOG_AFTER_MS - 1)
    expect(dialog()).toBeNull()
    await held.end({ deleted: ['/work/big'] })
    await done
    await wait()
    expect(deleteRun.value).toBeNull()
    expect(dialog()).toBeNull()
  })

  it('shows the dialog at two seconds and takes it away when the delete ends', async () => {
    const held = holdDelete()
    mountDialog()
    const done = deletePaths(['/work/big'])
    await wait(DELETE_DIALOG_AFTER_MS - 1)
    expect(dialog()).toBeNull()
    await wait(1)
    expect(dialog()?.textContent).toContain('big')
    await held.end({ deleted: ['/work/big'] })
    await done
    expect(dialog()).toBeNull()
  })

  it('names how many items go when there are several', async () => {
    const held = holdDelete()
    mountDialog()
    const done = deletePaths(['/work/big', '/work/one.md'])
    await wait()
    expect(dialog()?.textContent).toContain('2 items')
    await held.end()
    await done
  })
})

describe('what the dialog shows (ISC-788)', () => {
  async function shown() {
    const held = holdDelete()
    mountDialog()
    const done = deletePaths(['/work/big'])
    await wait()
    return { held, done }
  }

  it('has no figure before the system counts, on a long bar styled as the indexing one', async () => {
    const { held, done } = await shown()
    expect(bar().hasAttribute('aria-valuenow')).toBe(false)
    expect(state()).toBe('Preparing…')
    expect(bar().className).toContain('h-1')
    expect(bar().className).toContain('w-full')
    expect(bar().className).toContain('rounded-full')
    expect(part('[data-delete-bar]').className).toContain('bg-primary')
    expect(cancelButton().disabled).toBe(false)
    await held.end()
    await done
  })

  it('shows the percent while the system counts', async () => {
    const { held, done } = await shown()
    await held.tell({ phase: 'counting', percent: 42 })
    expect(bar().getAttribute('aria-valuenow')).toBe('42')
    expect(part('[data-delete-bar]').style.width).toBe('42%')
    expect(state()).toBe('Counting… 42%')
    await held.end()
    await done
  })

  it('has no figure while moving, and Cancel is disabled', async () => {
    const { held, done } = await shown()
    await held.tell({ phase: 'counting', percent: 42 })
    await held.tell({ phase: 'moving' })
    expect(bar().hasAttribute('aria-valuenow')).toBe(false)
    expect(part('[data-delete-bar]').style.width).toBe('')
    expect(state()).toMatch(/^Moving to the /)
    expect(cancelButton().disabled).toBe(true)
    cancelRunningDelete()
    expect(held.cancel).not.toHaveBeenCalled()
    await held.end()
    await done
  })

  it('asks the host to stop on Cancel, and stays until the delete has ended', async () => {
    const { held, done } = await shown()
    cancelButton().click()
    await flush()
    expect(held.cancel).toHaveBeenCalledTimes(1)
    expect(state()).toBe('Cancelling…')
    expect(cancelButton().disabled).toBe(true)
    expect(dialog()).not.toBeNull()
    await held.end({ cancelled: true })
    await done
    expect(dialog()).toBeNull()
  })

  it('takes Escape as Cancel', async () => {
    const { held, done } = await shown()
    part('[data-delete-state]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flush()
    expect(held.cancel).toHaveBeenCalledTimes(1)
    expect(dialog()).not.toBeNull()
    await held.end({ cancelled: true })
    await done
  })
})

describe('the app behind the dialog (ISC-789)', () => {
  it('runs no shortcut and takes no click while the dialog is open', async () => {
    const run = vi.fn()
    cleanups.push(
      registerCommand({
        id: 'test.behind',
        title: 'Behind',
        group: 'App',
        keybinding: 'Mod+Shift+Y',
        run,
      }),
      installKeybindings(window, 'other'),
    )
    const press = async (): Promise<KeyboardEvent> => {
      const event = new KeyboardEvent('keydown', {
        key: 'y',
        code: 'KeyY',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      ;(dialog() ?? document.body).dispatchEvent(event)
      await flush()
      return event
    }
    const held = holdDelete()
    mountDialog()
    const done = deletePaths(['/work/big'])
    await press()
    expect(run).toHaveBeenCalledTimes(1)
    await wait()
    const swallowed = await press()
    expect(run).toHaveBeenCalledTimes(1)
    expect(swallowed.defaultPrevented).toBe(true)
    // The dialog is modal: the page behind it takes no pointer, under an overlay.
    expect(document.body.style.pointerEvents).toBe('none')
    expect(document.body.querySelector('[data-slot="alert-dialog-overlay"]')).not.toBeNull()
    await held.end()
    await done
    await wait(100)
    await press()
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('when a delete ends (ISC-790)', () => {
  it('closes the tabs of what is gone, keeps the others with their edits, and says why', async () => {
    const one = await edited('/work/one.md')
    const two = await edited('/work/two.md')
    const real = host.deleteEntries.bind(host)
    vi.spyOn(host, 'deleteEntries').mockImplementation(async (_paths, onProgress) => {
      await real(['/work/one.md'], onProgress)
      return {
        ...NOTHING,
        deleted: ['/work/one.md'],
        kept: [{ path: '/work/two.md', reason: 'it is too big', cancelled: false }],
      }
    })
    await deletePaths(['/work/one.md', '/work/two.md'])
    await flush()
    expect(isOpen(one.id)).toBe(false)
    expect(isOpen(two.id)).toBe(true)
    expect(documentOfTab(two.tab)?.dirty).toBe(true)
    expect(names()).not.toContain('one.md')
    expect(names()).toContain('two.md')
    expect(toasts.messages).toEqual(['Could not delete two.md: it is too big'])
  })

  it('keeps every tab and says nothing after a Cancel', async () => {
    const one = await edited('/work/one.md')
    const held = holdDelete()
    const done = deletePaths(['/work/one.md'])
    await flush()
    await held.end({
      kept: [{ path: '/work/one.md', reason: 'the delete was cancelled', cancelled: true }],
      cancelled: true,
    })
    await done
    expect(isOpen(one.id)).toBe(true)
    expect(toasts.messages).toEqual([])
  })

  it('keeps every tab and says so when the delete fails as a whole', async () => {
    const one = await edited('/work/one.md')
    const held = holdDelete()
    const done = deletePaths(['/work/one.md'])
    await flush()
    await held.fail('the shell stopped')
    await done
    expect(isOpen(one.id)).toBe(true)
    expect(toasts.last).toBe('Could not delete one.md: the shell stopped')
  })

  it('closes the tab of a file removed for good inside a folder that stayed', async () => {
    const a = await edited('/work/big/a.md')
    const b = await edited('/work/big/b.md')
    const held = holdDelete()
    const done = deletePaths(['/work/big'])
    await flush()
    await held.end({
      kept: [{ path: '/work/big', reason: 'it was not removed', cancelled: false }],
      destroyed: ['/work/big/a.md'],
    })
    await done
    expect(isOpen(a.id)).toBe(false)
    expect(isOpen(b.id)).toBe(true)
    expect(toasts.messages).toEqual([
      'Removed for good, not moved to the Recycle Bin: a.md',
      'Could not delete big: it was not removed',
    ])
  })

  it('puts several failures in one message', async () => {
    const held = holdDelete()
    const done = deletePaths(['/work/one.md', '/work/two.md'])
    await flush()
    await held.end({
      kept: [
        { path: '/work/one.md', reason: 'it is busy', cancelled: false },
        { path: '/work/two.md', reason: 'it is busy', cancelled: false },
      ],
    })
    await done
    expect(toasts.messages).toEqual(['Could not delete one.md: it is busy and 1 more'])
  })
})

describe('a window close during a delete (ISC-791)', () => {
  it('cancels the delete and ends the app once it is over', async () => {
    await startJournal()
    const held = holdDelete()
    const done = deletePaths(['/work/big'])
    await flush()
    host.requestClose()
    await flush()
    expect(held.cancel).toHaveBeenCalledTimes(1)
    expect(host.quits).toBe(0)
    await held.end({ cancelled: true })
    await done
    await flush()
    expect(host.quits).toBe(1)
  })

  it('writes the session at once, and again with what the delete left', async () => {
    await startJournal()
    await edited('/work/big/a.md')
    const written = vi.spyOn(host, 'writeSession')
    const held = holdDelete()
    const done = deletePaths(['/work/big'])
    await flush()
    host.requestClose()
    await flush()
    // Rust gives the page only so long, so the session does not hang on the delete.
    expect(written).toHaveBeenCalledTimes(1)
    expect(written.mock.lastCall?.[0]).toContain('/work/big/a.md')
    await held.end({ deleted: ['/work/big'] })
    await done
    await flush()
    expect(written.mock.calls.length).toBeGreaterThan(1)
    expect(written.mock.lastCall?.[0]).not.toContain('/work/big/a.md')
    expect(host.quits).toBe(1)
  })

  it('waits for a delete that is moving before the app ends', async () => {
    await startJournal()
    const held = holdDelete()
    const done = deletePaths(['/work/big'])
    await flush()
    await held.tell({ phase: 'moving' })
    host.requestClose()
    await flush()
    expect(host.quits).toBe(0)
    await held.end({ deleted: ['/work/big'] })
    await done
    await flush()
    expect(host.quits).toBe(1)
  })
})

describe('what Rust sends', () => {
  it('reads each step and refuses another shape', () => {
    expect(parseDeleteProgress({ phase: 'counting', percent: null })).toEqual({
      phase: 'counting',
      percent: null,
    })
    expect(parseDeleteProgress({ phase: 'counting', percent: 7 })).toEqual({
      phase: 'counting',
      percent: 7,
    })
    expect(parseDeleteProgress({ phase: 'moving' })).toEqual({ phase: 'moving' })
    expect(() => parseDeleteProgress({ phase: 'done' })).toThrow('unknown delete phase')
    expect(() => parseDeleteProgress({ phase: 'counting' })).toThrow('percent')
  })

  it('reads a report and refuses another shape', () => {
    const report = {
      deleted: ['a'],
      kept: [{ path: 'b', reason: 'busy', cancelled: false }],
      destroyed: [],
      cancelled: false,
    }
    expect(parseDeleteReport(report)).toEqual(report)
    expect(() => parseDeleteReport({ ...report, kept: [{ path: 'b', reason: 'busy' }] })).toThrow(
      'cancelled',
    )
    expect(() => parseDeleteReport({ ...report, deleted: [1] })).toThrow('paths')
  })
})
