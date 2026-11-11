// @vitest-environment jsdom
/**
 * The delete question as drawn (ISC-227, ISC-228): a shadcn alert dialog, not a native one, that
 * says what goes, where it goes, how many tabs close and what is lost.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { followerOfTab, openPath, resetDocuments } from '@/documents/store'
import DeleteDialog from '@/features/tree/DeleteDialog.vue'
import { cancelDelete, deletePrompt, requestDelete } from '@/features/tree/ops'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
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

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined

beforeEach(async () => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  host = createMockHost({
    files: { '/work/notes/a.md': '# a\n', '/work/notes/b.md': '# b\n', '/work/z.txt': 'z' },
    roots: ['/work'],
  })
  setHost(host)
  await restoreWorkspace(['/work/notes'])
  await flush()
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(DeleteDialog)
  app.mount(root)
  mounted = { app, root }
})

afterEach(() => {
  cancelDelete()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
})

const dialog = (): HTMLElement | null => document.body.querySelector('[data-delete-dialog]')
const text = (): string => dialog()?.textContent.replace(/\s+/g, ' ').trim() ?? ''

describe('the delete dialog', () => {
  it('is not there until a delete is asked for', async () => {
    await flush()
    expect(dialog()).toBeNull()
  })

  it('names the file, says where it goes, and is a shadcn dialog, not a native one', async () => {
    await requestDelete('/work/z.txt')
    await flush()
    expect(dialog()?.getAttribute('role')).toBe('alertdialog')
    expect(dialog()?.getAttribute('data-slot')).toBe('alert-dialog-content')
    expect(text()).toContain('Delete "z.txt"?')
    expect(text()).toMatch(/The file moves to the (Recycle Bin|Trash)\./)
    expect(text()).not.toContain('tab')
  })

  it('says it is a folder, how many tabs close and what is lost', async () => {
    const a = await openPath('/work/notes/a.md')
    await openPath('/work/notes/b.md')
    followerOfTab(a)?.dispatch({ changes: { from: 0, insert: 'x' } })
    await requestDelete('/work/notes')
    await flush()
    expect(text()).toContain('Delete the folder "notes"?')
    expect(text()).toContain('everything in it')
    expect(text()).toContain('2 open tabs close.')
    expect(text()).toContain('It has unsaved changes, and they are lost.')
  })

  it('Cancel closes it and deletes nothing; Delete confirms', async () => {
    await requestDelete('/work/z.txt')
    await flush()
    const cancel = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Cancel',
    )
    expect(document.activeElement).toBe(cancel)
    cancel?.click()
    await flush()
    expect(dialog()).toBeNull()
    expect(deletePrompt.value).toBeNull()
    expect(host.files.has('/work/z.txt')).toBe(true)

    await requestDelete('/work/z.txt')
    await flush()
    document.body.querySelector<HTMLElement>('[data-delete-confirm]')?.click()
    await flush()
    expect(dialog()).toBeNull()
    expect(host.files.has('/work/z.txt')).toBe(false)
  })

  it('Escape cancels', async () => {
    await requestDelete('/work/z.txt')
    await flush()
    dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(deletePrompt.value).toBeNull()
    expect(host.files.has('/work/z.txt')).toBe(true)
  })
})
