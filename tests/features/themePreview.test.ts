// @vitest-environment jsdom
/**
 * The Theme preview in the page (P8-T7): the sample note in the app's own editor (ISC-519, 521),
 * which nothing can change (ISC-520), a miniature with no effect outside the tab (ISC-522), and a
 * view that follows a color change at once with no copy of any token (ISC-523).
 */
import { EditorView } from '@codemirror/view'
import { highlightTree } from '@lezer/highlight'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { codeLanguage } from '@/editor/codeLanguages'
import { FIND_COUNT_EVENT } from '@/editor/find'
import { tokenHighlight } from '@/editor/highlight'
import { changeThemeColor } from '@/features/themes/customize'
import { loadSettings, resetSettingsState } from '@/features/settings/store'
import {
  loadThemes,
  resetThemesState,
  settledThemes,
  watchThemesFolder,
} from '@/features/themes/store'
import ThemePreview from '@/features/themes/preview/ThemePreview.vue'
import { PREVIEW_FIND, PREVIEW_MISSING, PREVIEW_NOTE } from '@/features/themes/preview/previewNote'
import { resetSettings } from '@/lib/settings'
import { THEME_TOKENS } from '@/lib/themeTokens'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_SETTINGS_FILE,
  MOCK_THEMES_FOLDER,
  type MockHost,
} from '@/platform/mock'
import { findCounts } from '@/workbench/find'
import { tabDrag } from '@/workbench/tabDrag'
import { allTabs } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'
import { scanAll, stateOf, strangersOf, wholeTree } from '../helpers/preview'
import { tooltipApp } from '../helpers/tooltips'

// jsdom has no layout: the editor measures text with ranges, so they answer with nothing.
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Waits, in real time, for something that comes from a timer or a lazy load. */
async function until(done: () => boolean, ms = 6000): Promise<void> {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await nextTick()
  }
}

const themeFile = (name: string): string => `${MOCK_THEMES_FOLDER}/${name}.json`
const MINE = '{ "base": "dark", "colors": { "background": "#101418" } }'

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
const stops: (() => void)[] = []
/** Every host call made while the preview was on screen. */
const hostCalls: string[] = []
const findEvents: Event[] = []
const onFind = (event: Event): void => {
  findEvents.push(event)
}

async function mountPreview(): Promise<HTMLElement> {
  host = createMockHost({
    files: { [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }', [themeFile('mine')]: MINE },
  })
  setHost(host)
  await loadSettings()
  await loadThemes()
  stops.push(await watchThemesFolder())
  // From here on every host call is recorded: the preview must make none.
  setHost(
    new Proxy(host, {
      get(target, name, receiver) {
        const value = Reflect.get(target, name, receiver) as unknown
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          hostCalls.push(String(name))
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      },
    }),
  )
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(ThemePreview)
  app.mount(root)
  mounted = { app, root }
  await until(() => root.querySelector('.cm-content') !== null)
  return root
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
  resetThemesState()
  resetWorkbench()
  hostCalls.length = 0
  findEvents.length = 0
  document.documentElement.className = 'dark'
  document.documentElement.removeAttribute('style')
  document.addEventListener(FIND_COUNT_EVENT, onFind)
})

afterEach(async () => {
  document.removeEventListener(FIND_COUNT_EVENT, onFind)
  await settledThemes()
  while (stops.length > 0) stops.pop()?.()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
  setHost(undefined)
})

/** The editor of the preview. */
function editorOf(root: HTMLElement): EditorView {
  const dom = root.querySelector<HTMLElement>('.cm-editor')
  const view = dom === null ? null : EditorView.findFromDOM(dom)
  if (view === null) throw new Error('no editor in the preview')
  return view
}

/** The style rules the editor injected, as selector and body. */
function rules(): { selector: string; body: string }[] {
  const text: string[] = []
  for (const style of document.querySelectorAll('style')) text.push(style.textContent ?? '')
  for (const sheet of document.adoptedStyleSheets)
    for (const rule of sheet.cssRules) text.push(rule.cssText)
  const found: { selector: string; body: string }[] = []
  for (const match of text.join('\n').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({
      selector: (match[1] ?? '').replace(/\s+/g, ' ').trim(),
      body: match[2] ?? '',
    })
  }
  return found
}

/**
 * The classes the note asks for, over the whole note and not only what the page has drawn (jsdom has
 * no layout, so it draws the first screen): the marks and lines of the live preview, and the
 * highlight classes of every fenced block, each parsed in its own language.
 */
async function classesOfNote(): Promise<Set<string>> {
  const classes = new Set<string>()
  const state = stateOf(PREVIEW_NOTE, 0)
  for (const item of scanAll(state)) {
    if (item.type === 'mark' || item.type === 'line')
      for (const name of item.class.split(' ')) classes.add(name)
  }
  const blocks: { info: string; text: string }[] = []
  wholeTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const info = node.node.getChild('CodeInfo')
      const code = node.node.getChild('CodeText')
      if (info === null || code === null) return
      blocks.push({
        info: state.doc.sliceString(info.from, info.to),
        text: state.doc.sliceString(code.from, code.to),
      })
    },
  })
  for (const block of blocks) {
    const support = await codeLanguage(block.info)?.load()
    if (support === undefined) continue
    highlightTree(
      support.language.parser.parse(block.text),
      tokenHighlight,
      (_from, _to, names) => {
        for (const name of names.split(' ')) classes.add(name)
      },
    )
  }
  return classes
}

/** The token colors, by name prefix, that the rules of the editor give to those classes. */
function tokensOf(classes: ReadonlySet<string>, prefix: string): Set<string> {
  const used = new Set<string>()
  for (const rule of rules()) {
    const reaches = rule.selector.split(',').some((selector) => {
      const last =
        selector
          .trim()
          .split(/[\s>+~]+/)
          .pop() ?? ''
      const names = [...last.matchAll(/\.([^.\s:>+~[\],()]+)/g)].map((m) => m[1] ?? '')
      return names.length > 0 && names.every((name) => classes.has(name))
    })
    if (!reaches) continue
    for (const match of rule.body.matchAll(new RegExp(`var\\(--(${prefix}[a-z-]*)\\)`, 'g')))
      used.add(match[1] ?? '')
  }
  return used
}

describe('every syntax color shows on something in the note (ISC-519)', () => {
  it('uses all fourteen', { timeout: 20000 }, async () => {
    // The preview is mounted for its rules: the editor puts them on the page when it starts.
    await mountPreview()
    const classes = await classesOfNote()
    const names = THEME_TOKENS.filter((token) => token.name.startsWith('syntax-')).map(
      (token) => token.name,
    )
    expect(names).toHaveLength(14)
    const used = tokensOf(classes, 'syntax-')
    expect(names.filter((name) => !used.has(name))).toEqual([])
  })
})

describe('nothing can change the sample note (ISC-520)', () => {
  it('is read-only and cannot be focused for typing', async () => {
    const root = await mountPreview()
    const view = editorOf(root)
    expect(view.state.readOnly).toBe(true)
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')
    expect(view.state.doc.toString()).toBe(PREVIEW_NOTE)
  })

  it('keeps the note when a paste, a drop, Enter and a typed key reach it', async () => {
    const root = await mountPreview()
    const view = editorOf(root)
    const before = view.state.doc.toString()
    const data = { getData: () => 'pasted words', types: ['text/plain'], files: [], items: [] }

    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.assign(paste, { clipboardData: data })
    view.contentDOM.dispatchEvent(paste)

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.assign(drop, { dataTransfer: data, clientX: 10, clientY: 10 })
    view.contentDOM.dispatchEvent(drop)

    for (const key of ['Enter', 'Tab', 'Backspace', 'x']) {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    }
    view.contentDOM.dispatchEvent(
      new InputEvent('beforeinput', { data: 'x', inputType: 'insertText', bubbles: true }),
    )
    await settle()
    expect(view.state.doc.toString()).toBe(before)
  })

  it('keeps its three selection ranges when it is clicked, double-clicked, dragged over or keyed', async () => {
    const root = await mountPreview()
    const view = editorOf(root)
    const ranges = () => view.state.selection.ranges.map((range) => [range.from, range.to])
    const before = ranges()
    expect(before).toHaveLength(3)
    // A line a real click would land on: pointer events carry coordinates the editor turns into a position.
    const line = root.querySelector<HTMLElement>('.cm-line')
    expect(line).not.toBeNull()

    const fire = (type: string, detail = 1): boolean =>
      (line ?? view.contentDOM).dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === 'mouseup' ? 0 : 1,
          detail,
          clientX: 12,
          clientY: 12,
        }),
      )
    fire('mousedown')
    fire('mouseup')
    fire('mousedown', 2)
    fire('mouseup', 2)
    fire('mousedown', 3)
    fire('mousemove')
    fire('mouseup', 3)
    for (const key of ['ArrowRight', 'ArrowDown', 'Home', 'End']) {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    }
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await settle()
    expect(ranges()).toEqual(before)
  })
})

describe('the note shows a find match, a selection and the two kinds of link (ISC-521)', () => {
  it('has three selection ranges and marks every match of the query, one of them the current', async () => {
    const root = await mountPreview()
    const view = editorOf(root)
    expect(view.state.selection.ranges).toHaveLength(3)
    await until(() => root.querySelector('.cm-md-find-active') !== null)
    const matches = root.querySelectorAll('.cm-md-find')
    expect(matches.length).toBeGreaterThan(1)
    expect(root.querySelectorAll('.cm-md-find-active')).toHaveLength(1)
    expect(root.querySelector('.cm-md-find-active')?.textContent?.toLowerCase()).toBe(PREVIEW_FIND)
  })

  it('draws the link to a missing file as broken, and the other as a link', async () => {
    const root = await mountPreview()
    await until(() => root.querySelector('.cm-md-link-broken') !== null)
    const broken = [...root.querySelectorAll('.cm-md-link-broken')]
    expect(broken.map((element) => element.textContent).join('')).toContain('old design')
    expect(root.textContent).toContain('roadmap')
    expect(
      [...root.querySelectorAll('.cm-md-link-broken')].some((e) => e.textContent === 'roadmap'),
    ).toBe(false)
    expect(PREVIEW_NOTE).toContain(PREVIEW_MISSING)
  })
})

describe('the miniature has no effect outside the tab (ISC-522)', () => {
  it('adds nothing to the page outside its own root', async () => {
    const root = await mountPreview()
    await until(() => root.querySelector('.cm-md-link-broken') !== null)
    expect(strangersOf(root)).toEqual([])
  })

  it('has no window-drag region and no window controls', async () => {
    const root = await mountPreview()
    expect(root.querySelector('[data-tauri-drag-region]')).toBeNull()
    expect(root.querySelector('[data-settings-gear]')).toBeNull()
    // The title bar's buttons are drawn, not live: nothing in it can be pressed.
    const mini = root.querySelector<HTMLElement>('[data-mini-app]')
    expect(mini?.getAttribute('aria-hidden')).toBe('true')
    expect(mini?.querySelector('header button')).toBeNull()
  })

  it('leaves the layout, the documents, the host and the status bar alone when it is used', async () => {
    const root = await mountPreview()
    await until(() => root.querySelector('.cm-md-find-active') !== null)
    const layout = workbenchLayout.value
    for (const element of root.querySelectorAll<HTMLElement>('[data-tab-id], [data-mini-row]')) {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }))
    }
    for (const button of root.querySelectorAll('button')) button.click()
    await settle()
    expect(workbenchLayout.value).toBe(layout)
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(tabDrag.value).toBeNull()
    // The editor counts its matches and says so with an event that bubbles; it stops at the tab.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(findEvents).toEqual([])
    expect(findCounts.size).toBe(0)
    expect(hostCalls).toEqual([])
  })
})

describe('a color change shows at once, with no copy of a token (ISC-523)', () => {
  it('has the new color on the root and no custom property of its own anywhere in the preview', async () => {
    const root = await mountPreview()
    await changeThemeColor('foreground', '#fafafa', true)
    await settle()
    expect(document.documentElement.style.getPropertyValue('--foreground')).toBe('#fafafa')
    await changeThemeColor('selection', '#112233', true)
    expect(document.documentElement.style.getPropertyValue('--selection')).toBe('#112233')

    const own = [...root.querySelectorAll<HTMLElement>('*')]
      .filter((element) => /--[a-z]/.test(element.getAttribute('style') ?? ''))
      .map((element) => element.getAttribute('style'))
    expect(own).toEqual([])
    // The preview reads every color from a token: the editor draws the selection with var(--selection).
    expect(
      rules().some(
        (rule) =>
          rule.selector.includes('.cm-selectionBackground') &&
          rule.body.includes('var(--selection)'),
      ),
    ).toBe(true)
  })
})
