// @vitest-environment jsdom
// ISC-752 to ISC-755: Go to line, driven through its box the way a user would, against the browser
// stand-in for the host.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { activeDocument, followerOfTab, openInActivePane, resetDocuments } from '@/documents/store'
import { editorKeymap } from '@/editor/create'
import { columnAt, parseLineTarget, positionOf } from '@/editor/goToLine'
import { blocksOf } from '@/editor/livePreview/blocks'
import { Text } from '@codemirror/state'
import { revealedRange } from '@/editor/revealMark'
import PaletteHost from '@/features/palette/PaletteHost.vue'
import { commandRows } from '@/features/palette/rows'
import { closePalette, paletteMode } from '@/features/palette/state'
import { resetSettings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { buildMenuEntries, findMenuItem } from '@/shell/menuEntries'
import { clearCommands, getCommand, isCommandEnabled, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { PaneEditor } from '@/workbench/paneEditor'
import { findPane } from '@/workbench/splitTree'
import { openSettingsTab, resetWorkbench, workbenchLayout } from '@/workbench/store'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

const NOTE = [
  '---', // 1
  'title: x',
  '---',
  '',
  '# Heading', // 5
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |', // 9
  '',
  'some **bold** text', // 11
  'last',
].join('\n')

const FILES: Record<string, string> = {
  '/work/note.md': NOTE,
  '/work/data.json': '{\n  "a": 1\n}\n',
}

let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined
let pane: PaneEditor | undefined

const Shell = defineComponent({
  setup: () => () =>
    paletteMode.value === null
      ? null
      : h(PaletteHost, { key: paletteMode.value, mode: paletteMode.value }),
})

beforeEach(() => {
  // jsdom has no layout. CodeMirror asks ranges for their rectangles when it measures.
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  resetSettings()
  resetDocuments()
  resetWorkbench()
  clearCommands()
  setHost(createMockHost({ files: FILES }))
  removeCommands = registerDefaultCommands()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(Shell)
  app.mount(root)
  mounted = { app, root }
})

afterEach(() => {
  closePalette()
  mounted?.app.unmount()
  mounted = undefined
  pane?.destroy()
  pane = undefined
  removeCommands?.()
  setHost(undefined)
  document.body.replaceChildren()
})

/** Opens a file and shows its tab in a real editor view, as a pane does. */
async function open(path: string, raw = false): Promise<PaneEditor> {
  const tab = await openInActivePane(path)
  const parent = document.createElement('div')
  document.body.append(parent)
  pane = new PaneEditor(parent)
  pane.setRaw(raw)
  pane.show(followerOfTab(tab)!)
  await flush()
  return pane
}

const input = (): HTMLInputElement | null => document.querySelector('[data-palette-input]')

async function type(text: string): Promise<void> {
  const box = input()!
  box.value = text
  box.dispatchEvent(new Event('input'))
  await flush()
}

async function key(name: string): Promise<void> {
  input()!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
  await flush()
}

/** The caret as `line:column`. */
function caret(shown: PaneEditor): string {
  const state = shown.view!.state
  const head = state.selection.main.head
  return `${String(state.doc.lineAt(head).number)}:${String(columnAt(state.doc, head))}`
}

describe('reading what is typed (ISC-754)', () => {
  it.each([
    ['12', { line: 12, column: 1 }],
    [' 12 : 5 ', { line: 12, column: 5 }],
    ['12:', { line: 12, column: 1 }],
    ['0', { line: 0, column: 1 }],
  ])('reads %j', (text, expected) => {
    expect(parseLineTarget(text)).toEqual(expected)
  })

  it.each(['', 'a', '12a', ':4', '-3', '1.5', '1:2:3'])('takes %j for no number', (text) => {
    expect(parseLineTarget(text)).toBeNull()
  })

  it('goes to the nearest line and column when the number is out of range', () => {
    const doc = Text.of(['one', 'three', ''])
    expect(positionOf(doc, { line: 0, column: 1 })).toBe(0)
    expect(positionOf(doc, { line: 99, column: 1 })).toBe(doc.length)
    expect(positionOf(doc, { line: 2, column: 99 })).toBe(doc.line(2).to)
    expect(positionOf(doc, { line: 2, column: 0 })).toBe(doc.line(2).from)
  })

  it('counts a character outside the first plane as one column', () => {
    const doc = Text.of(['a😀b'])
    expect(positionOf(doc, { line: 1, column: 3 })).toBe(3)
    expect(columnAt(doc, 3)).toBe(3)
  })
})

describe('the command (ISC-752)', () => {
  it('is bound to Mod+G, which the editor does not use, and is in the menu', async () => {
    expect(getCommand(COMMAND_IDS.goToLine)?.keybinding).toBe('Mod+G')
    expect(getCommand(COMMAND_IDS.goToLine)?.title).toBe('Go to Line...')
    expect(editorKeymap.map((binding) => binding.key)).not.toContain('Mod-g')
    expect(findMenuItem(buildMenuEntries(), COMMAND_IDS.goToLine)).toBeDefined()
    expect(commandRows('go to line').map((row) => row.key)).toContain(COMMAND_IDS.goToLine)
    await open('/work/note.md')
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    expect(paletteMode.value).toBe('line')
    expect(document.activeElement).toBe(input())
  })

  it('puts the caret on the line and column on Enter and closes', async () => {
    const shown = await open('/work/note.md')
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    await type('11:6')
    await key('Enter')
    expect(paletteMode.value).toBeNull()
    expect(caret(shown)).toBe('11:6')
  })
})

describe('the jump while typing (ISC-753)', () => {
  it('follows the number, and Escape puts the caret back', async () => {
    const shown = await open('/work/note.md')
    shown.view!.dispatch({ selection: { anchor: shown.view!.state.doc.line(5).from + 2 } })
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    await type('1')
    expect(caret(shown)).toBe('1:1')
    await type('11')
    expect(caret(shown)).toBe('11:1')
    // The caret does not show without focus; the line is marked so the target can be seen.
    const line = shown.view!.state.doc.line(11)
    expect(revealedRange(shown.view!.state)).toEqual({ from: line.from, to: line.to })
    await key('Escape')
    expect(revealedRange(shown.view!.state)).toBeNull()
    expect(paletteMode.value).toBeNull()
    expect(caret(shown)).toBe('5:3')
  })

  it('goes back when its key is pressed again in the box', async () => {
    const remove = installKeybindings(window, 'other')
    const shown = await open('/work/note.md')
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    await type('12')
    input()!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'g',
        code: 'KeyG',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await flush()
    remove()
    expect(paletteMode.value).toBeNull()
    expect(caret(shown)).toBe('1:1')
  })

  it('goes back when a click outside or another picker closes it', async () => {
    const shown = await open('/work/note.md')
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    await type('12')
    document.querySelector('[data-palette]')!.dispatchEvent(new MouseEvent('mousedown'))
    await flush()
    expect(caret(shown)).toBe('1:1')
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    await type('11')
    await runCommand(COMMAND_IDS.commandPalette)
    await flush()
    expect(paletteMode.value).toBe('commands')
    expect(caret(shown)).toBe('1:1')
    expect(document.activeElement).toBe(input())
  })

  it('gives the scroll position back with the caret', async () => {
    const shown = await open('/work/note.md')
    const snapshots: unknown[] = []
    const real = shown.view!.scrollSnapshot.bind(shown.view!)
    shown.view!.scrollSnapshot = () => {
      const effect = real()
      snapshots.push(effect)
      return effect
    }
    const seen: unknown[] = []
    const dispatch = shown.view!.dispatch.bind(shown.view!)
    shown.view!.dispatch = ((...specs: Parameters<typeof dispatch>) => {
      for (const spec of specs) seen.push(...[(spec as { effects?: unknown }).effects].flat())
      dispatch(...specs)
    }) as typeof dispatch
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    await type('12')
    await key('Escape')
    expect(snapshots).toHaveLength(1)
    expect(seen).toContain(snapshots[0])
  })

  it('moves nothing for text that is not a number, and says the range', async () => {
    const shown = await open('/work/note.md')
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    expect(document.querySelector('[data-palette-summary]')?.textContent).toContain('1 to 12')
    await type('abc')
    expect(caret(shown)).toBe('1:1')
    await key('Enter')
    expect(paletteMode.value).toBe('line')
    expect(caret(shown)).toBe('1:1')
  })
})

describe('every text tab (ISC-755)', () => {
  it('shows a line inside a collapsed frontmatter or a drawn table', async () => {
    const shown = await open('/work/note.md')
    shown.view!.dispatch({ selection: { anchor: shown.view!.state.doc.length } })
    const kinds = (): string[] => blocksOf(shown.view!.state).map((block) => block.kind)
    expect(kinds()).toEqual(['frontmatter', 'table'])
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    await type('2')
    expect(kinds()).toEqual(['table'])
    await type('9')
    expect(kinds()).toEqual(['frontmatter'])
    await key('Enter')
    expect(caret(shown)).toBe('9:1')
  })

  it.each([
    ['raw Markdown', '/work/note.md', true],
    ['another file', '/work/data.json', false],
  ])('works in %s', async (_name, path, raw) => {
    const shown = await open(path, raw)
    await runCommand(COMMAND_IDS.goToLine)
    await flush()
    await type('2')
    await key('Enter')
    expect(caret(shown)).toBe('2:1')
    expect(activeDocument()).toBeDefined()
  })

  it('is disabled with no text tab: an empty pane and the Settings tab', () => {
    expect(isCommandEnabled(COMMAND_IDS.goToLine)).toBe(false)
    openSettingsTab()
    const layout = workbenchLayout.value
    expect(findPane(layout, layout.activePane)?.activeTab).not.toBeNull()
    expect(isCommandEnabled(COMMAND_IDS.goToLine)).toBe(false)
  })
})
