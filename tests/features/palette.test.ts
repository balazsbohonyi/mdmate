// @vitest-environment jsdom
// ISC-130 and ISC-131: the file picker (Ctrl+P) and the command palette (Ctrl+Shift+P), driven from
// the keyboard alone, the way a user would, against the browser stand-in for the host.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { activeDocument, resetDocuments } from '@/documents/store'
import PaletteHost from '@/features/palette/PaletteHost.vue'
import { indexStatus } from '@/features/index/status'
import { commandRows, fileRow, segments } from '@/features/palette/rows'
import { closePalette, paletteMode } from '@/features/palette/state'
import { setHost } from '@/platform'
import { IDLE_INDEX } from '@/platform/indexStatus'
import { createMockHost, type MockHost } from '@/platform/mock'
import { clearCommands, registerCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { resetWorkbench } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const FILES: Record<string, string> = {
  '/work/readme.md': '# readme\n',
  '/work/notes/plan.md': '# plan\n',
  '/work/notes/idea.md': '# idea\n',
  '/work/docs/planning/roadmap.md': '# roadmap\n',
  '/work/.git/config': '[core]\n',
}

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
let removeKeys: (() => void) | undefined
let removeCommands: (() => void) | undefined

/** What AppShell does: the picker exists while a mode is set, and a new mode is a new picker. */
const Shell = defineComponent({
  setup: () => () =>
    paletteMode.value === null
      ? null
      : h(PaletteHost, { key: paletteMode.value, mode: paletteMode.value }),
})

function mountShell(): HTMLElement {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(Shell)
  app.mount(root)
  mounted = { app, root }
  return root
}

async function start(files: Record<string, string> = FILES, nextHost?: MockHost): Promise<void> {
  host = nextHost ?? createMockHost({ files, roots: ['/work'] })
  setHost(host)
  removeCommands = registerDefaultCommands()
  removeKeys = installKeybindings(window, 'other')
  mountShell()
  await flush()
}

beforeEach(() => {
  resetDocuments()
  resetWorkbench()
  paletteMode.value = null
})

afterEach(() => {
  paletteMode.value = null
  removeKeys?.()
  removeCommands?.()
  clearCommands()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  removeKeys = undefined
  removeCommands = undefined
  setHost(undefined)
  document.body.innerHTML = ''
})

const input = (): HTMLInputElement | null => document.querySelector('[data-palette-input]')
/** A row as it reads: the name, then the folder or shortcut, with the gap the page draws. */
const rowText = (row: Element): string =>
  [...row.children]
    .map((part) => (part.textContent ?? '').trim())
    .filter((part) => part !== '')
    .join(' ')
const rowsText = (): string[] => [...document.querySelectorAll('[data-palette-row]')].map(rowText)
const selectedText = (): string => {
  const row = document.querySelector('[data-palette-row][aria-selected="true"]')
  return row === null ? '' : rowText(row)
}

/** Presses a key where the user's focus is: the box of the open picker, or the page. */
function press(
  props: { key: string; code?: string; ctrlKey?: boolean; shiftKey?: boolean },
  on: EventTarget = input() ?? document.body,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code: '',
    bubbles: true,
    cancelable: true,
    ...props,
  })
  on.dispatchEvent(event)
  return event
}

async function type(text: string): Promise<void> {
  const box = input()
  if (box === null) throw new Error('no picker is open')
  box.value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

const ctrlP = { key: 'p', code: 'KeyP', ctrlKey: true }
const ctrlShiftP = { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }

describe('Ctrl+P finds a file by a partial name (ISC-130)', () => {
  it('opens from the key, lists the files, and takes typing without a click', async () => {
    await start()
    expect(input()).toBeNull()
    press(ctrlP, document.body)
    await flush()
    expect(paletteMode.value).toBe('files')
    expect(document.activeElement).toBe(input())
    // The index lists every file of the open folder but what is inside `.git`.
    expect(rowsText().some((row) => row.includes('config'))).toBe(false)
    expect(rowsText()).toHaveLength(4)
  })

  it('finds a file from a few letters of its name and opens it with Enter', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    await type('pln')
    expect(rowsText()[0]).toBe('plan.md notes')
    press({ key: 'Enter' })
    await flush()
    expect(paletteMode.value).toBeNull()
    expect(activeDocument()?.path).toBe('/work/notes/plan.md')
  })

  it('finds a file by a letter pattern that reaches into its folder', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    await type('planroad')
    expect(rowsText()).toEqual(['roadmap.md docs/planning'])
  })

  it('moves with the arrow keys, wraps at both ends, and opens the one it is on', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    await type('md')
    const all = rowsText()
    expect(all.length).toBeGreaterThan(2)
    expect(selectedText()).toBe(all[0])
    press({ key: 'ArrowDown' })
    await flush()
    expect(selectedText()).toBe(all[1])
    press({ key: 'ArrowUp' })
    press({ key: 'ArrowUp' })
    await flush()
    expect(selectedText()).toBe(all.at(-1))
    press({ key: 'ArrowDown' })
    await flush()
    expect(selectedText()).toBe(all[0])
    press({ key: 'ArrowDown' })
    press({ key: 'Enter' })
    await flush()
    const opened = activeDocument()?.path ?? ''
    expect(all[1]?.startsWith(opened.split('/').pop() ?? '?')).toBe(true)
  })

  it('marks the letters that matched', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    await type('pl')
    const first = document.querySelector('[data-palette-row]')
    expect([...(first?.querySelectorAll('b') ?? [])].map((mark) => mark.textContent)).toEqual([
      'pl',
    ])
  })

  it('says so when nothing matches, and Enter then does nothing', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    await type('zzzq')
    expect(rowsText()).toEqual([])
    expect(document.querySelector('[data-palette-summary]')?.textContent).toContain(
      'No file matches',
    )
    press({ key: 'Enter' })
    await flush()
    expect(paletteMode.value).toBe('files')
  })

  it('says so when the open folders hold no files', async () => {
    await start({}, createMockHost({ files: {}, roots: [] }))
    press(ctrlP, document.body)
    await flush()
    expect(document.querySelector('[data-palette-summary]')?.textContent).toContain('no files')
  })

  it('shows how many files matched when more than the best are listed', async () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 60; i++) many[`/work/n${String(i).padStart(2, '0')}.md`] = 'x\n'
    await start(many)
    press(ctrlP, document.body)
    await flush()
    await type('n')
    expect(rowsText()).toHaveLength(50)
    expect(document.querySelector('[data-palette-footer]')?.textContent).toContain('50 of 60 files')
  })

  it('shows the answer to the last thing typed, not a slower one to an earlier thing', async () => {
    host = createMockHost({ files: FILES, roots: ['/work'] })
    const fast = host.quickOpenQuery.bind(host)
    let releaseSlow: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const patched: MockHost = Object.assign(host, {
      async quickOpenQuery(query: string, limit: number) {
        const answer = await fast(query, limit)
        // The answer to "p" is held back until the answer to "idea" is already on screen.
        if (query === 'p') await held
        return answer
      },
    })
    await start(FILES, patched)
    press(ctrlP, document.body)
    await flush()
    await type('p')
    await type('idea')
    expect(rowsText()).toEqual(['idea.md notes'])
    releaseSlow()
    await flush()
    expect(rowsText()).toEqual(['idea.md notes'])
  })

  it('opens with the index answer and never asks the host to read the folders again', async () => {
    const asked: string[] = []
    const patched: MockHost = Object.assign(createMockHost({ files: FILES, roots: ['/work'] }), {
      quickOpenQuery: (query: string) => {
        asked.push(query)
        return Promise.resolve({
          items: [{ path: '/work/a.md', rel: 'a.md', nameStart: 0, matches: [] }],
          total: 1,
          indexed: 1,
          truncated: false,
        })
      },
    })
    await start(FILES, patched)
    press(ctrlP, document.body)
    await flush()
    expect(rowsText()).toEqual(['a.md'])
    // One question on open, and the host has nothing to rebuild with.
    expect(asked).toEqual([''])
    expect('quickOpenRefresh' in patched).toBe(false)
  })

  it('asks again while a folder is read for the first time, and keeps the row the user is on', async () => {
    let names = ['a.md', 'b.md']
    const patched: MockHost = Object.assign(createMockHost({ files: FILES, roots: ['/work'] }), {
      quickOpenQuery: () =>
        Promise.resolve({
          items: names.map((name) => ({
            path: '/work/' + name,
            rel: name,
            nameStart: 0,
            matches: [],
          })),
          total: names.length,
          indexed: names.length,
          truncated: false,
        }),
    })
    await start(FILES, patched)
    press(ctrlP, document.body)
    await flush()
    press({ key: 'ArrowDown' })
    await flush()
    expect(selectedText()).toBe('b.md')
    names = ['a.md', 'b.md', 'c.md']
    indexStatus.value = { indexing: true, percent: 40, cut: [] }
    await flush()
    expect(rowsText()).toEqual(['a.md', 'b.md', 'c.md'])
    expect(selectedText()).toBe('b.md')
    indexStatus.value = IDLE_INDEX
  })

  it('shows a failed search instead of an empty list', async () => {
    host = createMockHost({ files: FILES, roots: ['/work'] })
    const broken: MockHost = Object.assign(host, {
      quickOpenQuery: () => Promise.reject(new Error('disk gone')),
    })
    await start(FILES, broken)
    press(ctrlP, document.body)
    await flush()
    expect(document.querySelector('[data-palette-summary]')?.textContent).toContain('disk gone')
  })
})

describe('Ctrl+Shift+P runs a command by name (ISC-131)', () => {
  it('lists the registered commands with their shortcuts, without the palette commands', async () => {
    await start()
    press(ctrlShiftP, document.body)
    await flush()
    expect(paletteMode.value).toBe('commands')
    const all = rowsText()
    expect(all).toContain('Toggle Sidebar Ctrl+Shift+B')
    expect(all).toContain('Open Folder... Ctrl+Shift+O')
    expect(all.some((row) => row.startsWith('Go to File'))).toBe(false)
    expect(all.some((row) => row.startsWith('Show Command Palette'))).toBe(false)
  })

  it('finds a command from a few letters of its name and runs it with Enter', async () => {
    await start()
    const before = (await import('@/workbench/sidebar')).sidebarVisible.value
    press(ctrlShiftP, document.body)
    await flush()
    await type('tgsid')
    expect(rowsText()[0]).toBe('Toggle Sidebar Ctrl+Shift+B')
    press({ key: 'Enter' })
    await flush()
    expect((await import('@/workbench/sidebar')).sidebarVisible.value).toBe(!before)
    expect(paletteMode.value).toBeNull()
  })

  it('closes the palette before the command runs', async () => {
    await start()
    let openWhenRun: string | null | undefined
    registerCommand({
      id: 'test.probe',
      title: 'Probe Order',
      run: () => {
        openWhenRun = paletteMode.value
      },
    })
    press(ctrlShiftP, document.body)
    await flush()
    await type('probe')
    press({ key: 'Enter' })
    await flush()
    expect(openWhenRun).toBeNull()
  })

  it('shows a command that cannot run greyed, and choosing it does nothing', async () => {
    await start()
    press(ctrlShiftP, document.body)
    await flush()
    await type('save')
    const row = document.querySelector('[data-palette-row]')
    expect(row?.textContent).toContain('Save')
    expect(row?.getAttribute('aria-disabled')).toBe('true')
    press({ key: 'Enter' })
    await flush()
    // Still open: nothing ran, and the user can pick another.
    expect(paletteMode.value).toBe('commands')
  })

  it('says so when no command matches', async () => {
    await start()
    press(ctrlShiftP, document.body)
    await flush()
    await type('zzzq')
    expect(document.querySelector('[data-palette-summary]')?.textContent).toContain(
      'No command matches',
    )
  })

  it('reports a command that throws, and still closes', async () => {
    await start()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    registerCommand({
      id: 'test.boom',
      title: 'Boom',
      run: () => {
        throw new Error('nope')
      },
    })
    press(ctrlShiftP, document.body)
    await flush()
    await type('boom')
    press({ key: 'Enter' })
    await flush()
    expect(logged).toHaveBeenCalled()
    expect(paletteMode.value).toBeNull()
    logged.mockRestore()
  })
})

describe('using both from the keyboard alone', () => {
  it('closes with Escape and gives focus back to where it was', async () => {
    await start()
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()
    press(ctrlP, before)
    await flush()
    expect(document.activeElement).toBe(input())
    press({ key: 'Escape' })
    await flush()
    expect(paletteMode.value).toBeNull()
    expect(document.activeElement).toBe(before)
  })

  it('closes with the same key that opened it, and switches with the other one', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    press(ctrlShiftP)
    await flush()
    expect(paletteMode.value).toBe('commands')
    expect(input()?.value).toBe('')
    expect(document.activeElement).toBe(input())
    press(ctrlShiftP)
    await flush()
    expect(paletteMode.value).toBeNull()
  })

  it('keeps every other shortcut from acting on the page behind it', async () => {
    await start()
    const ran = vi.fn()
    registerCommand({ id: 'test.spy', title: 'Spy', keybinding: 'Mod+J', run: ran })
    // Control: on the page the shortcut runs.
    press({ key: 'j', code: 'KeyJ', ctrlKey: true }, document.body)
    await flush()
    expect(ran).toHaveBeenCalledTimes(1)
    press(ctrlP, document.body)
    await flush()
    const event = press({ key: 'j', code: 'KeyJ', ctrlKey: true })
    await flush()
    expect(ran).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(paletteMode.value).toBe('files')
  })

  it('goes to the first row on a new search, and Tab leaves focus where it is', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    await type('md')
    press({ key: 'ArrowDown' })
    await type('mdx')
    await type('md')
    expect(selectedText()).toBe(rowsText()[0])
    const tab = press({ key: 'Tab' })
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(input())
  })

  it('goes back to the first command when what is typed changes', async () => {
    await start()
    press(ctrlShiftP, document.body)
    await flush()
    await type('o')
    press({ key: 'ArrowDown' })
    press({ key: 'ArrowDown' })
    await flush()
    expect(selectedText()).toBe(rowsText()[2])
    await type('op')
    expect(selectedText()).toBe(rowsText()[0])
  })

  it('moves a page at a time with PageDown and PageUp, and stops at the ends', async () => {
    await start()
    press(ctrlShiftP, document.body)
    await flush()
    const all = rowsText()
    expect(all.length).toBeGreaterThan(9)
    press({ key: 'PageDown' })
    await flush()
    expect(selectedText()).toBe(all[8])
    press({ key: 'PageUp' })
    await flush()
    expect(selectedText()).toBe(all[0])
    press({ key: 'PageUp' })
    await flush()
    expect(selectedText()).toBe(all[0])
    all.forEach(() => press({ key: 'PageDown' }))
    await flush()
    expect(selectedText()).toBe(all[all.length - 1])
  })

  it('leaves focus alone when what was chosen took it, as opening a file does', async () => {
    await start()
    const before = document.createElement('button')
    const taken = document.createElement('textarea')
    document.body.append(before, taken)
    registerCommand({ id: 'test.focus', title: 'Take Focus', run: () => taken.focus() })
    before.focus()
    press(ctrlShiftP, before)
    await flush()
    await type('take focus')
    press({ key: 'Enter' })
    await flush()
    expect(paletteMode.value).toBeNull()
    expect(document.activeElement).toBe(taken)
  })

  it('closes when the dimmed area behind it is clicked', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    const backdrop = document.querySelector('[data-palette]')
    backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flush()
    expect(paletteMode.value).toBeNull()
  })

  it('opens a file when its row is clicked', async () => {
    await start()
    press(ctrlP, document.body)
    await flush()
    await type('idea')
    document.querySelector<HTMLElement>('[data-palette-row]')?.click()
    await flush()
    expect(activeDocument()?.path).toBe('/work/notes/idea.md')
  })

  it('is registered under the shortcuts the plan names', () => {
    expect(COMMAND_IDS.quickOpen).toBe('file.quickOpen')
    expect(COMMAND_IDS.commandPalette).toBe('view.commandPalette')
    closePalette()
  })
})

describe('the lines of a picker', () => {
  it('puts a file name first and its folder after it, each with its own marks', () => {
    const row = fileRow({
      path: '/work/docs/plan.md',
      rel: 'docs/plan.md',
      nameStart: 5,
      matches: [0, 5, 6],
    })
    expect(row).toMatchObject({
      label: 'plan.md',
      detail: 'docs',
      labelHits: [0, 1],
      detailHits: [0],
    })
  })

  it('splits text at marked letters by UTF-16 offset', () => {
    expect(segments('plan.md', [0, 1])).toEqual([
      { text: 'pl', hit: true },
      { text: 'an.md', hit: false },
    ])
    expect(segments('😀ab', [2])).toEqual([
      { text: '😀', hit: false },
      { text: 'a', hit: true },
      { text: 'b', hit: false },
    ])
    expect(segments('', [])).toEqual([])
    expect(segments('abc', [])).toEqual([{ text: 'abc', hit: false }])
  })

  it('lists all commands by title for nothing typed', () => {
    host = createMockHost({ files: FILES, roots: ['/work'] })
    setHost(host)
    removeCommands = registerDefaultCommands()
    const titles = commandRows('').map((row) => row.label)
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)))
    expect(titles).toContain('Bold')
  })
})
