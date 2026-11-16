// @vitest-environment jsdom
/**
 * The gallery and the states strip of the Theme preview (P8-T7 part 2): every control and floating
 * surface of the app (ISC-526), the fixed states strip (ISC-527), no effect outside the tab
 * (ISC-528), token classes only (ISC-529), and the live controls against the inert pictures
 * (ISC-530).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type App } from 'vue'
import { toast } from 'vue-sonner'
import { FIND_COUNT_EVENT } from '@/editor/find'
import { changeThemeColor } from '@/features/themes/customize'
import { loadSettings, resetSettingsState } from '@/features/settings/store'
import {
  loadThemes,
  resetThemesState,
  settledThemes,
  watchThemesFolder,
} from '@/features/themes/store'
import ThemePreview from '@/features/themes/preview/ThemePreview.vue'
import { resetSettings } from '@/lib/settings'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_SETTINGS_FILE,
  MOCK_THEMES_FOLDER,
  type MockHost,
} from '@/platform/mock'
import { allTabs } from '@/workbench/splitTree'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'
import { strangersOf } from '../helpers/preview'
import { tooltipApp } from '../helpers/tooltips'

// jsdom has no layout: the editor measures text with ranges, so they answer with nothing.
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
})

// The dropdown opens on a pointer press and moves with pointer capture, which jsdom does not have.
Object.assign(Element.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: () => undefined,
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function until(done: () => boolean, ms = 6000): Promise<void> {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await nextTick()
  }
}

const MINE = '{ "base": "dark", "colors": { "background": "#101418" } }'

let host: MockHost
let mounted: { app: App; root: HTMLElement } | undefined
const stops: (() => void)[] = []
const hostCalls: string[] = []
const findEvents: Event[] = []
const onFind = (event: Event): void => {
  findEvents.push(event)
}

async function mountPreview(): Promise<HTMLElement> {
  host = createMockHost({
    files: {
      [MOCK_SETTINGS_FILE]: '{ "theme": "mine" }',
      [`${MOCK_THEMES_FOLDER}/mine.json`]: MINE,
    },
  })
  setHost(host)
  await loadSettings()
  await loadThemes()
  stops.push(await watchThemesFolder())
  // From here on every host call is recorded: the gallery must make none.
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
  await until(() => root.querySelector('[data-gallery]') !== null)
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
  vi.restoreAllMocks()
  await settledThemes()
  while (stops.length > 0) stops.pop()?.()
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = undefined
  document.body.replaceChildren()
  setHost(undefined)
})

const must = <T extends Element>(parent: ParentNode, selector: string): T => {
  const found = parent.querySelector<T>(selector)
  if (found === null) throw new Error(`nothing matches ${selector}`)
  return found
}
const item = (root: HTMLElement, id: string): HTMLElement =>
  must<HTMLElement>(root, `[data-gallery-item="${id}"]`)
const cell = (root: HTMLElement, sample: string, state: string): HTMLElement =>
  must<HTMLElement>(root, `[data-sample="${sample}"][data-state="${state}"]`)
const texts = (list: Iterable<Element>): string[] =>
  [...list].map((element) => element.textContent.replace(/\s+/g, ' ').trim())

const ITEMS = [
  'buttons',
  'field',
  'switch',
  'dropdown',
  'tooltip',
  'dialog',
  'context-menu',
  'toasts',
  'find-bar',
  'palette',
  'messages',
  'scrollbar',
]

describe('the gallery has every control and floating surface of the app (ISC-526)', () => {
  it('has one item for each, in order, below the miniature', async () => {
    const root = await mountPreview()
    const ids = [...root.querySelectorAll<HTMLElement>('[data-gallery-item]')].map(
      (one) => one.dataset.galleryItem,
    )
    expect(ids).toEqual(ITEMS)
    const mini = must(root, '[data-preview-app]')
    const gallery = must(root, '[data-gallery]')
    expect(mini.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('draws the six button variants, each with the look of its own, and the sizes', async () => {
    const root = await mountPreview()
    const buttons = item(root, 'buttons')
    const variants = [...buttons.querySelectorAll<HTMLElement>('[data-gallery-variant]')]
    expect(variants.map((one) => one.dataset.galleryVariant)).toEqual([
      'default',
      'outline',
      'secondary',
      'ghost',
      'destructive',
      'link',
    ])
    const sign: Record<string, string> = {
      default: 'bg-primary',
      outline: 'bg-background',
      secondary: 'bg-secondary',
      ghost: 'hover:bg-muted',
      destructive: 'text-destructive',
      link: 'underline-offset-4',
    }
    for (const one of variants) {
      expect(one.className, one.dataset.galleryVariant).toContain(
        sign[one.dataset.galleryVariant ?? ''],
      )
    }
    const sizes = [...buttons.querySelectorAll<HTMLElement>('[data-gallery-size]')]
    expect(sizes.map((one) => one.dataset.gallerySize)).toEqual([
      'xs',
      'sm',
      'default',
      'lg',
      'icon',
      'icon-sm',
      'disabled',
    ])
    expect(must<HTMLButtonElement>(buttons, '[data-gallery-size="disabled"]').disabled).toBe(true)
  })

  it('has a text field with its text, switches on and off, and a dropdown on its pick', async () => {
    const root = await mountPreview()
    expect(must<HTMLInputElement>(item(root, 'field'), 'input').value).toBe('Tidewatch')
    const switches = [...item(root, 'switch').querySelectorAll('[data-slot="switch"]')]
    expect(switches.map((one) => one.getAttribute('data-state'))).toEqual(['checked', 'unchecked'])
    expect(item(root, 'dropdown').textContent).toContain('Dark')
  })

  it('has a tooltip, a dialog, a context menu, two toasts, the find bar and the palette', async () => {
    const root = await mountPreview()
    expect(item(root, 'tooltip').textContent).toContain('Next match (F3)')

    const dialog = item(root, 'dialog')
    expect(dialog.textContent).toContain('Delete Sepia copy?')
    expect(texts(dialog.querySelectorAll('button'))).toEqual(['Cancel', 'Delete'])
    expect(must(dialog, 'button:last-of-type').className).toContain('text-destructive')

    const menu = item(root, 'context-menu')
    expect(texts(menu.querySelectorAll('div.flex'))).toEqual([
      'Cut',
      'Copy Ctrl+C',
      'Paste Ctrl+V',
      'Delete',
    ])

    const toasts = item(root, 'toasts')
    expect(toasts.querySelectorAll('.rounded-2xl')).toHaveLength(2)
    expect(toasts.textContent).toContain('Could not open notes.md')
    expect(toasts.textContent).toContain('Link target not found.')
    // The icon colors are the ones styles/toasts.css gives a real error and a real warning toast.
    expect(toasts.querySelectorAll('svg.text-destructive')).toHaveLength(1)
    expect(toasts.querySelectorAll('svg.text-syntax-heading')).toHaveLength(1)

    const bar = item(root, 'find-bar')
    expect(must(bar, 'input[aria-label="Find"]')).toBeDefined()
    expect(must(bar, 'input[aria-label="Replace with"]')).toBeDefined()
    expect(texts(bar.querySelectorAll('button')).filter((text) => text !== '')).toEqual([
      'Find',
      'Find Prev',
      'Replace',
      'Replace all',
    ])
    expect(must(bar, 'button[aria-label="Match case"]').getAttribute('aria-pressed')).toBe('true')

    const palette = item(root, 'palette')
    expect(palette.querySelectorAll('li')).toHaveLength(3)
    expect(must(palette, 'li').className).toContain('bg-accent')
  })

  it('has the four messages and a scrollbar box that scrolls', async () => {
    const root = await mountPreview()
    const messages = must(item(root, 'messages'), 'div')
    expect(messages.children).toHaveLength(4)
    expect(must(messages, 'p').className).toContain('text-success')
    expect(messages.innerHTML).toContain('text-warning')
    expect(messages.innerHTML).toContain('text-destructive')
    expect(must(messages, '.bg-card')).toBeDefined()
    const box = must<HTMLElement>(item(root, 'scrollbar'), '[data-gallery-scroll]')
    expect(box.className).toContain('overflow-y-scroll')
    expect(box.querySelectorAll('p').length).toBeGreaterThan(10)
    expect(box.tabIndex).toBe(0)
  })
})

describe('the states strip (ISC-527)', () => {
  const STATES = ['hover', 'focus', 'disabled', 'error', 'selected']
  /** What each sample shows, by state; the others are empty because that control has no such look. */
  const SHOWN: Record<string, string[]> = {
    button: STATES,
    field: ['focus', 'disabled', 'error'],
    switch: ['focus', 'disabled', 'error', 'selected'],
    row: ['hover', 'selected'],
    name: ['focus', 'error'],
    menu: ['hover', 'focus', 'disabled', 'error'],
  }

  it('has the five states in order', async () => {
    const root = await mountPreview()
    const heads = [...root.querySelectorAll<HTMLElement>('[data-state-heading]')]
    expect(heads.map((one) => one.dataset.stateHeading)).toEqual(STATES)
    expect(texts(heads)).toEqual(['hover', 'focus', 'disabled', 'error', 'selected'])
  })

  it('has a look in the states each sample has, and nothing in the others', async () => {
    const root = await mountPreview()
    for (const [sample, shown] of Object.entries(SHOWN)) {
      for (const state of STATES) {
        const has = cell(root, sample, state).childElementCount > 0
        expect(has, `${sample} ${state}`).toBe(shown.includes(state))
      }
    }
  })

  it('makes disabled, error and selected real states, not classes made up for the picture', async () => {
    const root = await mountPreview()
    expect(must<HTMLButtonElement>(cell(root, 'button', 'disabled'), 'button').disabled).toBe(true)
    expect(must(cell(root, 'button', 'error'), 'button').getAttribute('aria-invalid')).toBe('true')
    expect(must(cell(root, 'button', 'selected'), 'button').getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(must<HTMLInputElement>(cell(root, 'field', 'disabled'), 'input').disabled).toBe(true)
    expect(must(cell(root, 'field', 'error'), 'input').getAttribute('aria-invalid')).toBe('true')
    expect(must<HTMLButtonElement>(cell(root, 'switch', 'disabled'), 'button').disabled).toBe(true)
    expect(must(cell(root, 'switch', 'error'), 'button').getAttribute('aria-invalid')).toBe('true')
    expect(must(cell(root, 'switch', 'selected'), 'button').getAttribute('data-state')).toBe(
      'checked',
    )
    expect(must(cell(root, 'row', 'selected'), 'span').getAttribute('aria-selected')).toBe('true')
    expect(must(cell(root, 'menu', 'disabled'), 'span').getAttribute('aria-disabled')).toBe('true')
  })

  it('gives hover and focus the classes the control uses for them', async () => {
    const root = await mountPreview()
    expect(must(cell(root, 'button', 'hover'), 'button').className).toContain('bg-muted')
    for (const sample of ['button', 'field', 'switch']) {
      const focused = must(cell(root, sample, 'focus'), 'button, input')
      expect(focused.className, sample).toContain('border-ring')
      expect(focused.className, sample).toContain('ring-ring/50')
    }
    expect(must(cell(root, 'name', 'focus'), 'input').className).toContain('border-ring')
    expect(must(cell(root, 'name', 'error'), 'input').className).toContain('border-destructive')
    expect(must(cell(root, 'row', 'hover'), 'span').className).toContain('bg-sidebar-accent/50')
    expect(
      must(cell(root, 'row', 'selected'), 'span').classList.contains('bg-sidebar-accent'),
    ).toBe(true)
    expect(must(cell(root, 'button', 'selected'), 'button').className).toContain('bg-primary')
    expect(must(cell(root, 'menu', 'hover'), 'span').className).toContain('bg-accent')
    expect(must(cell(root, 'menu', 'error'), 'span').className).toContain('text-destructive')
  })
})

/** Opens the dropdown with the pointer, as the settings tests do. */
async function openDropdown(root: HTMLElement): Promise<HTMLElement[]> {
  const trigger = must<HTMLElement>(item(root, 'dropdown'), '[role="combobox"]')
  trigger.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
  )
  trigger.click()
  await settle()
  await nextTick()
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')]
}

describe('nothing in the gallery or the strip has an effect outside the tab (ISC-528)', () => {
  it('leaves the page, the layout, the host, the toasts and the tabs alone when it is used', async () => {
    const root = await mountPreview()
    const layout = workbenchLayout.value
    const toasts = (['error', 'warning', 'success', 'info', 'message'] as const).map((kind) =>
      vi.spyOn(toast, kind),
    )
    const gallery = must(root, '[data-gallery]')
    const strip = must(root, '[data-states-strip]')
    for (const part of [gallery, strip]) {
      for (const element of part.querySelectorAll<HTMLElement>('*')) {
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }))
        element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }))
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
        element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
      }
      for (const button of part.querySelectorAll('button')) button.click()
      for (const input of part.querySelectorAll('input')) {
        input.value = 'typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
    const options = await openDropdown(root)
    options
      .find((one) => one.textContent.trim() === 'Sepia')
      ?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }),
      )
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(workbenchLayout.value).toBe(layout)
    expect(allTabs(workbenchLayout.value)).toEqual([])
    expect(hostCalls).toEqual([])
    expect(findEvents).toEqual([])
    for (const spy of toasts) expect(spy).not.toHaveBeenCalled()
    expect(document.querySelector('[data-sonner-toast], [role="dialog"], [role="menu"]')).toBeNull()
    // The popup stays in the page for a moment as "closed" while it fades; it must not be open.
    expect(document.querySelector('[role="listbox"]:not([data-state="closed"])')).toBeNull()
    expect(strangersOf(root)).toEqual([])
  })

  it('finds a stray element in the body, so the check above can fail', async () => {
    const root = await mountPreview()
    expect(strangersOf(root)).toEqual([])
    // An empty wrapper, a second placeholder and a popup left open are each a stray.
    const wrapper = document.createElement('div')
    document.body.append(wrapper)
    expect(strangersOf(root)).toEqual([wrapper])
    wrapper.remove()
    const second = document.createElement('div')
    second.append(document.createComment('teleport start'), document.createComment('teleport end'))
    document.body.append(second)
    expect(strangersOf(root)).toHaveLength(1)
    second.remove()
    const popup = document.createElement('div')
    popup.setAttribute('role', 'listbox')
    document.body.append(popup)
    expect(strangersOf(root)).toEqual([popup])
    popup.remove()
    // Text with no attribute on it is a stray too, and so is a wrapper with nothing in it and no other placeholder.
    const text = document.createElement('div')
    text.textContent = 'open'
    document.body.append(text)
    expect(strangersOf(root)).toEqual([text])
    text.remove()
    // Two nodes that are not the teleport comments, and the right comments on a div with an attribute.
    const spans = document.createElement('div')
    spans.append(document.createElement('span'), document.createElement('span'))
    document.body.prepend(spans)
    expect(strangersOf(root)).toEqual([spans])
    spans.remove()
    const marked = document.createElement('div')
    marked.setAttribute('role', 'listbox')
    marked.append(document.createComment('teleport start'), document.createComment('teleport end'))
    document.body.prepend(marked)
    expect(strangersOf(root)).toEqual([marked])
    marked.remove()
  })

  it('leaves nothing in the page when the tab closes, after the dropdown was opened and used', async () => {
    const root = await mountPreview()
    const options = await openDropdown(root)
    options
      .find((one) => one.textContent.trim() === 'Light')
      ?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }),
      )
    await settle()
    mounted?.app.unmount()
    mounted = undefined
    await settle()
    expect([...document.body.children]).toEqual([root])
    expect(root.childElementCount).toBe(0)
  })
})

/** Tailwind's own palette and arbitrary color values: none of them belongs in the gallery. */
const LITERAL =
  /(^|\s|:)(bg|text|border|ring|fill|stroke|outline|decoration|shadow|from|to|via)-(\[[^\]]*(#|rgb|hsl|oklch|oklab)[^\]]*\]|white|black|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(\/\d+)?(\s|$)/

describe('the gallery and the strip use token classes only (ISC-529)', () => {
  it('has no color literal in a class and no color or custom property in a style', async () => {
    const root = await mountPreview()
    const mine = [...root.querySelectorAll('[data-gallery] *, [data-states-strip] *')]
    expect(mine.length).toBeGreaterThan(100)
    const bad: string[] = []
    for (const element of mine) {
      const classes = element.getAttribute('class') ?? ''
      if (LITERAL.test(classes)) bad.push(`class: ${classes}`)
      const style = element.getAttribute('style') ?? ''
      if (/--[a-z]|color|background|#[0-9a-f]{3}|rgb|hsl|oklch/i.test(style))
        bad.push(`style: ${style}`)
    }
    expect(bad).toEqual([])
  })

  it('has a pattern that finds a planted color, so the check above can fail', () => {
    for (const planted of ['p-2 bg-red-500', 'text-white', 'border-[#ff0000]', 'ring-blue-600/50'])
      expect(LITERAL.test(planted), planted).toBe(true)
    for (const fine of ['bg-primary', 'text-destructive', 'border-ring/50', 'ring-foreground/10'])
      expect(LITERAL.test(fine), fine).toBe(false)
  })

  it('follows a color change at once: the root has it and the gallery holds no copy', async () => {
    const root = await mountPreview()
    await changeThemeColor('destructive', '#ff2200', true)
    await settle()
    expect(document.documentElement.style.getPropertyValue('--destructive')).toBe('#ff2200')
    const own = [...root.querySelectorAll<HTMLElement>('*')].filter((element) =>
      /--[a-z]/.test(element.getAttribute('style') ?? ''),
    )
    expect(own).toEqual([])
  })
})

describe('the live controls work and the pictures cannot be used (ISC-530)', () => {
  it('takes typing in the text field and in the find bar boxes', async () => {
    const root = await mountPreview()
    for (const input of [
      must<HTMLInputElement>(item(root, 'field'), 'input'),
      must<HTMLInputElement>(item(root, 'find-bar'), 'input[aria-label="Find"]'),
      must<HTMLInputElement>(item(root, 'find-bar'), 'input[aria-label="Replace with"]'),
    ]) {
      input.value = 'Hello'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      expect(input.value).toBe('Hello')
    }
  })

  it('flips a switch when it is pressed', async () => {
    const root = await mountPreview()
    const [on, off] = [
      ...item(root, 'switch').querySelectorAll<HTMLElement>('[data-slot="switch"]'),
    ]
    on?.click()
    off?.click()
    await nextTick()
    expect(on?.getAttribute('data-state')).toBe('unchecked')
    expect(off?.getAttribute('data-state')).toBe('checked')
  })

  it('opens the real dropdown and shows what was picked', async () => {
    const root = await mountPreview()
    const options = await openDropdown(root)
    expect(texts(options)).toEqual(['Dark', 'Light', 'Sepia'])
    options
      .find((one) => one.textContent.trim() === 'Light')
      ?.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }),
      )
    await settle()
    await nextTick()
    expect(must(item(root, 'dropdown'), '[role="combobox"]').textContent).toContain('Light')
  })

  it('shows the real tooltip on the button that has one', async () => {
    const root = await mountPreview()
    const button = [...item(root, 'tooltip').querySelectorAll('button')].find(
      (one) => one.textContent.trim() === 'Hover me',
    )
    button?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    await settle()
    await nextTick()
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain(
      'This one is the real tooltip',
    )
  })

  it('has the tooltip, dialog, menu, toasts, palette and the states strip as inert pictures', async () => {
    const root = await mountPreview()
    const pictures = [...root.querySelectorAll<HTMLElement>('[data-gallery-picture]')]
    expect(pictures).toHaveLength(5)
    for (const picture of pictures) expect(picture.hasAttribute('inert')).toBe(true)
    expect(
      pictures.map((one) => one.closest('[data-gallery-item]')?.getAttribute('data-gallery-item')),
    ).toEqual(['tooltip', 'dialog', 'context-menu', 'toasts', 'palette'])
    expect(must(root, '[data-states-strip]').hasAttribute('inert')).toBe(true)
  })
})
