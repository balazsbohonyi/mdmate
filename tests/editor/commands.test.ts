// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { followerOfTab, openPath, resetDocuments } from '@/documents/store'
import { APP_KEYS, createState, editorKeymap } from '@/editor/create'
import {
  BOLD,
  INLINE_CODE,
  insertLink,
  ITALIC,
  shiftHeading,
  STRIKETHROUGH,
  toggleInline,
  type InlineFormat,
} from '@/editor/format'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { clearCommands, runCommand } from '@/workbench/commands'
import { COMMAND_IDS, registerDefaultCommands } from '@/workbench/defaultCommands'
import { installKeybindings } from '@/workbench/keyboard'
import { findPane } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'

/** `a[b]c`: the brackets mark the selection, `|` alone marks a caret. Returns doc and selection. */
function parse(marked: string): { doc: string; anchor: number; head: number } {
  const caret = marked.indexOf('|')
  if (caret !== -1) return { doc: marked.replace('|', ''), anchor: caret, head: caret }
  const from = marked.indexOf('[[')
  const to = marked.indexOf(']]') - 2
  return { doc: marked.replace('[[', '').replace(']]', ''), anchor: from, head: to }
}

function show(state: EditorState): string {
  const { from, to } = state.selection.main
  const doc = state.doc.toString()
  if (from === to) return doc.slice(0, from) + '|' + doc.slice(from)
  return doc.slice(0, from) + '[[' + doc.slice(from, to) + ']]' + doc.slice(to)
}

function apply(marked: string, run: (state: EditorState) => ReturnType<typeof insertLink>): string {
  const { doc, anchor, head } = parse(marked)
  const state = createState(doc).update({ selection: EditorSelection.single(anchor, head) }).state
  const spec = run(state)
  return spec === null ? show(state) : show(state.update(spec).state)
}

const toggle = (format: InlineFormat) => (state: EditorState) => toggleInline(state, format)

describe.each([
  ['bold (ISC-83)', BOLD, '**'],
  ['italic (ISC-84)', ITALIC, '*'],
  ['inline code (ISC-86)', INLINE_CODE, '`'],
  ['strikethrough (ISC-87)', STRIKETHROUGH, '~~'],
])('%s', (_name, format, m) => {
  it('wraps a selection and unwraps it again, keeping the text selected', () => {
    const on = apply('Some [[word]] here.', toggle(format))
    expect(on).toBe(`Some ${m}[[word]]${m} here.`)
    expect(apply(on, toggle(format))).toBe('Some [[word]] here.')
  })

  it('unwraps when the caret or a part of the text is inside the formatted span', () => {
    expect(apply(`Some ${m}wo|rd${m} here.`, toggle(format))).toBe('Some wo|rd here.')
    expect(apply(`Some ${m}w[[or]]d${m} here.`, toggle(format))).toBe('Some w[[or]]d here.')
  })

  it('unwraps when the selection includes the markers', () => {
    expect(apply(`Some [[${m}word${m}]] here.`, toggle(format))).toBe('Some [[word]] here.')
  })

  it('inserts an empty pair at a caret, with the caret between', () => {
    expect(apply('Text |end', toggle(format))).toBe(`Text ${m}|${m}end`)
  })

  it('starts a new pair at a caret right after a formatted span, instead of undoing it', () => {
    expect(apply(`Some ${m}word${m}| here.`, toggle(format))).toBe(
      `Some ${m}word${m}${m}|${m} here.`,
    )
    expect(apply(`Some |${m}word${m} here.`, toggle(format))).toBe(
      `Some ${m}|${m}${m}word${m} here.`,
    )
  })
})

describe('format edge cases', () => {
  it('bold and italic tell each other apart', () => {
    expect(apply('***bo|th***', toggle(ITALIC))).toBe('**bo|th**')
    expect(apply('***bo|th***', toggle(BOLD))).toBe('*bo|th*')
    expect(apply('**[[bold]]**', toggle(ITALIC))).toBe('***[[bold]]***')
  })

  it('treats underscores as the same format', () => {
    expect(apply('__b|old__', toggle(BOLD))).toBe('b|old')
    expect(apply('_it|al_', toggle(ITALIC))).toBe('it|al')
  })

  it('does not take markers inside code as formatting', () => {
    expect(apply('`a **[[b]]** c`', toggle(BOLD))).toBe('`a ****[[b]]**** c`')
  })

  it('changes nothing in a read-only document', () => {
    const locked = createState('word', [EditorState.readOnly.of(true)])
    expect(toggleInline(locked, BOLD)).toBeNull()
    expect(insertLink(locked)).toBeNull()
    expect(shiftHeading(locked, 'raise')).toBeNull()
  })
})

describe('insert link (ISC-85)', () => {
  it('turns selected text into a link and puts the caret in the target', () => {
    expect(apply('See [[the docs]] now', insertLink)).toBe('See [the docs](|) now')
  })

  it('turns a selected address into the target and puts the caret in the text', () => {
    expect(apply('See [[https://example.com/a]] now', insertLink)).toBe(
      'See [|](https://example.com/a) now',
    )
  })

  it('inserts an empty link at a caret', () => {
    expect(apply('See | now', insertLink)).toBe('See [|]() now')
  })
})

describe('heading level (ISC-88, ISC-89)', () => {
  const raise = (s: EditorState) => shiftHeading(s, 'raise')
  const lower = (s: EditorState) => shiftHeading(s, 'lower')

  it('raises toward H1 and stops there (ISC-88)', () => {
    expect(apply('Para|graph', raise)).toBe('###### Para|graph')
    expect(apply('### Ti|tle', raise)).toBe('## Ti|tle')
    expect(apply('## Ti|tle', raise)).toBe('# Ti|tle')
    expect(apply('# Ti|tle', raise)).toBe('# Ti|tle')
  })

  it('lowers toward a paragraph (ISC-89)', () => {
    expect(apply('# Ti|tle', lower)).toBe('## Ti|tle')
    expect(apply('##### Ti|tle', lower)).toBe('###### Ti|tle')
    expect(apply('###### Ti|tle', lower)).toBe('Ti|tle')
    expect(apply('Para|graph', lower)).toBe('Para|graph')
  })

  it('is undone by the other direction', () => {
    for (const start of ['# A|', '## A|', '###### A|', '### A|']) {
      expect(apply(apply(start, lower), raise)).toBe(start)
    }
    expect(apply(apply('Pl|ain', raise), lower)).toBe('Pl|ain')
  })

  it('changes every line the selection touches, and leaves code and blank lines alone', () => {
    // The selection stays on the text; the new marker lands in front of it.
    expect(apply('[[One\n\n## Two]]', raise)).toBe('###### [[One\n\n# Two]]')
    expect(apply('```\n## not| a heading\n```', raise)).toBe('```\n## not| a heading\n```')
    expect(apply('```\nplain| code\n```', raise)).toBe('```\nplain| code\n```')
  })
})

describe('the commands in the registry', () => {
  let removeCommands: () => void
  let uninstall: () => void
  beforeEach(() => {
    setHost(createMockHost({ files: { 'C:/n/a.md': 'Some word here.\n\n## Title\n' } }))
    resetWorkbench()
    resetDocuments()
    removeCommands = registerDefaultCommands()
    uninstall = installKeybindings(window, 'other')
  })
  afterEach(() => {
    uninstall()
    removeCommands()
    clearCommands()
    setHost(undefined)
  })

  const tab = () => {
    const id = findPane(workbenchLayout.value, workbenchLayout.value.activePane)?.activeTab
    if (id === null || id === undefined) throw new Error('no tab')
    return id
  }
  const text = () => followerOfTab(tab())?.state.doc.toString()

  it('run on the active tab, both ways, and undo in one step each', async () => {
    await openPath('C:/n/a.md')
    const follower = followerOfTab(tab())
    if (follower === undefined) throw new Error('no follower')
    follower.dispatch({ selection: EditorSelection.single(5, 9) })
    await runCommand(COMMAND_IDS.bold)
    expect(text()).toBe('Some **word** here.\n\n## Title\n')
    await runCommand(COMMAND_IDS.bold)
    expect(text()).toBe('Some word here.\n\n## Title\n')
    await runCommand(COMMAND_IDS.italic)
    expect(text()).toBe('Some *word* here.\n\n## Title\n')
    follower.undo()
    expect(text()).toBe('Some word here.\n\n## Title\n')
    follower.dispatch({ selection: EditorSelection.cursor(text()?.indexOf('Title') ?? 0) })
    await runCommand(COMMAND_IDS.headingUp)
    expect(text()).toBe('Some word here.\n\n# Title\n')
    await runCommand(COMMAND_IDS.headingDown)
    await runCommand(COMMAND_IDS.headingDown)
    expect(text()).toBe('Some word here.\n\n### Title\n')
  })

  it('answer their keys, Ctrl+I included, which the editor gives up', async () => {
    await openPath('C:/n/a.md')
    followerOfTab(tab())?.dispatch({ selection: EditorSelection.single(5, 9) })
    const press = (key: string, code: string, extra: KeyboardEventInit = {}) => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key, code, ctrlKey: true, cancelable: true, ...extra }),
      )
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    press('b', 'KeyB')
    await settle()
    expect(text()).toBe('Some **word** here.\n\n## Title\n')
    press('b', 'KeyB')
    press('i', 'KeyI')
    await settle()
    expect(text()).toBe('Some *word* here.\n\n## Title\n')
    press('i', 'KeyI')
    press('`', 'Backquote')
    await settle()
    expect(text()).toBe('Some `word` here.\n\n## Title\n')
    press('`', 'Backquote')
    press('%', 'Digit5', { ctrlKey: false, altKey: true, shiftKey: true })
    await settle()
    expect(text()).toBe('Some ~~word~~ here.\n\n## Title\n')
    expect(APP_KEYS.has('Mod-i')).toBe(true)
    expect(editorKeymap.some((binding) => binding.key === 'Mod-i')).toBe(false)
  })

  it('do nothing with no tab open', async () => {
    await runCommand(COMMAND_IDS.bold)
    await runCommand(COMMAND_IDS.headingUp)
  })
})
