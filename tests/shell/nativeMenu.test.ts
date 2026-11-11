// @vitest-environment jsdom
/**
 * ISC-242: the browser's own right-click menu (with "Inspect") never shows in the app, except on
 * text, where it is the only way to cut, copy and paste. The app's own menus must still open.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { openPath, resetDocuments } from '@/documents/store'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { blockNativeMenu, keepsNativeMenu, opensAppMenu } from '@/lib/nativeMenu'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { clearCommands } from '@/workbench/commands'
import { registerDefaultCommands } from '@/workbench/defaultCommands'
import { resetSidebar } from '@/workbench/sidebar'
import { resetWorkbench, tabInfo } from '@/workbench/store'
import TabStrip from '@/workbench/TabStrip.vue'

class FakeObserver {
  observe = (): undefined => undefined
  unobserve = (): undefined => undefined
  disconnect = (): undefined => undefined
}
Object.assign(globalThis, { ResizeObserver: FakeObserver })

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await settle()
    await nextTick()
  }
}

let remove: (() => void) | undefined
let mounted: { app: App; root: HTMLElement } | undefined
let removeCommands: (() => void) | undefined

beforeEach(() => {
  remove = blockNativeMenu()
  resetTree()
  resetWorkbench()
  resetDocuments()
  resetSidebar()
  clearCommands()
  removeCommands = registerDefaultCommands()
})

afterEach(() => {
  remove?.()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
  removeCommands?.()
  clearCommands()
  setHost(undefined)
  resetTree()
})

/** Right-clicks `target` and says whether the browser's menu was cancelled. */
function rightClick(target: Element): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

function add(html: string): HTMLElement {
  const holder = document.createElement('div')
  holder.innerHTML = html
  document.body.append(holder)
  return holder
}

const pick = (page: HTMLElement, id: string): Element => {
  const found = page.querySelector(`#${id}`)
  if (found === null) throw new Error(`no element ${id}`)
  return found
}

describe('where the browser menu is cancelled (ISC-242)', () => {
  it('cancels it on the sidebar, the status bar, an empty pane, the title bar and an image', () => {
    const page = add(
      '<aside id="s"><p id="header">Folders</p></aside><footer id="f">status</footer><div id="pane"></div><header id="t"></header><img id="i" alt="">',
    )
    for (const id of ['header', 's', 'f', 'pane', 't', 'i'])
      expect(rightClick(pick(page, id)), id).toBe(true)
  })

  it('leaves it on editor text, text boxes and editable elements', () => {
    const page = add(
      '<div class="cm-content"><div class="cm-line"><span id="word">text</span></div></div><input id="in"><textarea id="ta"></textarea><div contenteditable="true"><b id="ce">x</b></div>',
    )
    for (const id of ['word', 'in', 'ta', 'ce']) expect(rightClick(pick(page, id)), id).toBe(false)
  })

  it('cancels it on an element that says it is not editable', () => {
    const page = add('<div contenteditable="false"><span id="x">locked</span></div>')
    expect(rightClick(pick(page, 'x'))).toBe(true)
  })

  it('says what keeps the menu, for a target that is not an element too', () => {
    expect(keepsNativeMenu(null)).toBe(false)
    expect(keepsNativeMenu(document)).toBe(false)
    expect(keepsNativeMenu(pick(add('<input id="a">'), 'a'))).toBe(true)
  })

  it('leaves a trigger of an app menu alone, since its menu opens only on an event nobody cancelled', () => {
    const page = add('<div data-slot="context-menu-trigger"><span id="row">row</span></div>')
    expect(opensAppMenu(pick(page, 'row'))).toBe(true)
    expect(rightClick(pick(page, 'row'))).toBe(false)
  })

  it('stops cancelling when it is removed', () => {
    remove?.()
    remove = undefined
    const page = add('<p id="p">x</p>')
    expect(rightClick(pick(page, 'p'))).toBe(false)
  })
})

describe("the app's own menus still open", () => {
  it('a right-click on a tab opens the tab menu with the block installed, and the menu cancels the browser one itself', async () => {
    setHost(createMockHost({ files: { '/work/a.md': 'a\n' }, roots: ['/work'] }))
    await restoreWorkspace([])
    await flush()
    const id = await openPath('/work/a.md')
    const info = tabInfo(id)
    if (info === undefined) throw new Error('no tab')
    const root = document.createElement('div')
    document.body.append(root)
    const app = tooltipApp(TabStrip, { tabs: [info], activeId: id })
    app.mount(root)
    mounted = { app, root }
    await flush()
    const tab = root.querySelector('[role=tab]')
    if (tab === null) throw new Error('no tab drawn')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    tab.dispatchEvent(event)
    // The block leaves the tab to its menu, which cancels the browser menu once it has opened.
    expect(event.defaultPrevented).toBe(false)
    await flush()
    expect(event.defaultPrevented).toBe(true)
    expect(document.body.querySelector('[role=menu]')).not.toBeNull()
    expect(document.body.querySelector('[role=menuitem]')).not.toBeNull()
  })
})

describe('where it is installed', () => {
  it('main.ts installs it before the app mounts', () => {
    const source = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8')
    expect(source.indexOf('blockNativeMenu()')).toBeGreaterThan(-1)
    expect(source.indexOf('blockNativeMenu()')).toBeLessThan(source.indexOf('.mount('))
  })
})
