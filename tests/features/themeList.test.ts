// @vitest-environment jsdom
/**
 * The list of themes on the Appearance page (P8-T6): one list of every theme (ISC-478), New theme
 * and Duplicate (ISC-474, 475), inline Rename (ISC-476), Delete with its question (ISC-477), the
 * editor coming into view (ISC-481) and a built-in theme left alone (ISC-482).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type App } from 'vue'
import SettingsView from '@/features/settings/SettingsView.vue'
import { loadSettings, resetSettingsState, watchSettingsFile } from '@/features/settings/store'
import {
  loadThemes,
  resetThemesState,
  settledThemes,
  watchThemesFolder,
} from '@/features/themes/store'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import {
  createMockHost,
  MOCK_SETTINGS_FILE,
  MOCK_THEMES_FOLDER,
  type MockHost,
  type MockHostOptions,
} from '@/platform/mock'
import { panesOf } from '@/workbench/splitTree'
import {
  openSettingsTab,
  resetWorkbench,
  themePreviewTabId,
  workbenchLayout,
} from '@/workbench/store'
import { toasts } from '../helpers/toasts'
import { tooltipApp } from '../helpers/tooltips'

const scrolled = vi.fn()
Object.assign(HTMLElement.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => undefined,
  releasePointerCapture: () => undefined,
  scrollIntoView: scrolled,
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const themeFile = (name: string): string => `${MOCK_THEMES_FOLDER}/${name}.json`

async function flush(): Promise<void> {
  for (let round = 0; round < 8; round++) {
    await settle()
    await nextTick()
  }
}

let host: MockHost
let screen: { app: App; root: HTMLElement } | undefined
const stops: (() => void)[] = []

const LIGHT_ONE = '{ "name": "Zed", "base": "light", "colors": { "background": "#abcdef" } }'
const DARK_ONE = '{ "name": "alpha", "base": "dark", "colors": {} }'
const TWO = {
  [MOCK_SETTINGS_FILE]: '{ "theme": "Zed" }',
  [themeFile('Zed')]: LIGHT_ONE,
  [themeFile('alpha')]: DARK_ONE,
}

async function mountScreen(
  files: Record<string, string> = {},
  options: MockHostOptions = {},
): Promise<void> {
  host = createMockHost({ files, ...options })
  setHost(host)
  await loadSettings()
  await loadThemes()
  stops.push(await watchSettingsFile(), await watchThemesFolder())
  const root = document.createElement('div')
  document.body.append(root)
  const app = tooltipApp(SettingsView, { tabId: openSettingsTab('appearance') })
  app.mount(root)
  screen = { app, root }
  await flush()
}

/** Whether the New theme form was still open each time the editor was scrolled into view. */
const formOpenAtScroll: boolean[] = []

beforeEach(() => {
  scrolled.mockClear()
  formOpenAtScroll.length = 0
  scrolled.mockImplementation(() => {
    formOpenAtScroll.push(document.querySelector('[data-theme-new-form]') !== null)
  })
  resetSettings()
  resetSettingsState()
  resetThemesState()
  document.documentElement.className = 'dark'
  document.documentElement.removeAttribute('style')
})

afterEach(async () => {
  await settledThemes()
  while (stops.length > 0) stops.pop()?.()
  screen?.app.unmount()
  screen?.root.remove()
  screen = undefined
  document.body.replaceChildren()
  resetWorkbench()
  setHost(undefined)
})

const item = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-theme-item="${id}"]`)
  if (found === null) throw new Error(`no row for ${id}`)
  return found
}
const ids = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-theme-item]')].map(
    (row) => row.dataset.themeItem ?? '',
  )
const button = (id: string, kind: string): HTMLElement | null =>
  item(id).querySelector<HTMLElement>(`[data-theme-${kind}]`)

/** Opens the ellipsis menu of a row and returns what is in it (the menu is drawn in the body). */
async function openMenu(id: string): Promise<HTMLElement[]> {
  const trigger = item(id).querySelector<HTMLElement>('[data-theme-menu]')
  if (trigger === null) throw new Error('no menu for ' + id)
  trigger.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  )
  await flush()
  return [...document.querySelectorAll<HTMLElement>('[data-theme-menu-content] [role="menuitem"]')]
}

async function closeMenu(): Promise<void> {
  document
    .querySelector('[data-theme-menu-content]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flush()
}
const menuLabels = async (id: string): Promise<string[]> =>
  (await openMenu(id)).map((one) => one.textContent.trim())

/** Opens the menu of a row and picks the item of that kind. */
async function pressMenu(id: string, kind: string): Promise<void> {
  await openMenu(id)
  await press(document.querySelector<HTMLElement>(`[data-theme-menu-content] [data-theme-${kind}]`))
}

async function press(element: HTMLElement | null): Promise<void> {
  if (element === null) throw new Error('no such button')
  element.click()
  await flush()
  await settledThemes()
  await flush()
}

async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

const parsedName = (stem: string): string | undefined =>
  /"name":\s*"([^"]*)"/.exec(host.files.read(themeFile(stem)) ?? '')?.[1]

const themeStems = (): string[] =>
  host.files
    .paths()
    .filter((path) => path.startsWith(`${MOCK_THEMES_FOLDER}/`))
    .map((path) => path.slice(MOCK_THEMES_FOLDER.length + 1, -'.json'.length))
    .sort()

describe('ISC-478: the list', () => {
  it('shows Dark, Light, Sepia and System, then the user themes A to Z with case ignored', async () => {
    await mountScreen(TWO)
    expect(ids()).toEqual(['dark', 'light', 'sepia', 'system', 'alpha', 'Zed'])
    expect(document.querySelector('[data-settings-themes-heading]')?.textContent.trim()).toBe(
      'Themes',
    )
  })

  it('orders user themes by their names, not by their file names', async () => {
    await mountScreen({
      [themeFile('a1')]: '{ "name": "Zebra", "colors": {} }',
      [themeFile('b2')]: '{ "name": "apple", "colors": {} }',
      [themeFile('c3')]: '{ "colors": {} }',
    })
    expect(ids().slice(4)).toEqual(['b2', 'c3', 'a1'])
  })

  it('has the name, what it is based on and five swatches on a user theme, none for System', async () => {
    await mountScreen(TWO)
    expect(item('Zed').querySelector('[data-theme-name]')?.textContent.trim()).toBe('Zed')
    expect(item('Zed').textContent).toContain('Based on Light')
    expect(item('alpha').textContent).toContain('Based on Dark')
    expect(item('Zed').querySelectorAll('[data-theme-swatches] span')).toHaveLength(5)
    expect(item('dark').querySelectorAll('[data-theme-swatches] span')).toHaveLength(5)
    expect(item('system').querySelector('[data-theme-swatches]')).toBeNull()
    const first = item('Zed').querySelector<HTMLElement>('[data-theme-swatches] span')
    expect(first?.style.backgroundColor).not.toBe('')
  })

  it('marks the theme in use, and only that one, and follows a change', async () => {
    await mountScreen(TWO)
    expect(document.querySelectorAll('[data-theme-in-use-mark]')).toHaveLength(1)
    expect(item('Zed').querySelector('[data-theme-in-use-mark]')?.textContent.trim()).toBe('In use')
    await press(button('alpha', 'select'))
    expect(settings.theme).toBe('alpha')
    expect(item('alpha').querySelector('[data-theme-in-use-mark]')).not.toBeNull()
    expect(item('Zed').querySelector('[data-theme-in-use-mark]')).toBeNull()
  })

  it('gives every row Select, or a disabled green "In use" of the same width, and nothing else but the menu', async () => {
    await mountScreen({ ...TWO, [MOCK_SETTINGS_FILE]: '{ "theme": "alpha" }' })
    for (const id of ids()) {
      const labels = [...item(id).querySelectorAll('button')].map((one) => one.textContent.trim())
      expect(labels, id).toEqual([id === 'alpha' ? 'In use' : 'Select', ''])
    }
    const slot = (id: string): HTMLElement | null =>
      item(id).querySelector<HTMLElement>('[data-theme-state-slot]')
    const mark = item('alpha').querySelector<HTMLButtonElement>('[data-theme-in-use-mark]')
    expect(mark?.disabled).toBe(true)
    // Green by the theme's own success color: the text, the outline and a faint background.
    const classes = (mark?.className ?? '').split(' ')
    for (const wanted of [
      'text-success',
      'border-success/50',
      'bg-success/10',
      'dark:border-success/50',
      'dark:bg-success/10',
    ])
      expect(classes, wanted).toContain(wanted)
    // The outline button's own dark-scheme grey must be gone, or the green shows only in Light.
    expect(mark?.className).not.toMatch(/dark:(bg|border)-input/)
    expect(mark?.className).toContain('disabled:opacity-100')
    // One width: each button fills a slot, and every slot has the same width class.
    const widths = new Set(ids().map((id) => slot(id)?.className.match(/\bw-\d+\b/)?.[0]))
    expect([...widths]).toEqual(['w-20'])
    for (const id of ids()) {
      const one = item(id).querySelector('[data-theme-in-use-mark], [data-theme-select]')
      expect(one?.className, id).toContain('w-full')
    }
    // The in-use button does nothing.
    mark?.click()
    await flush()
    expect(settings.theme).toBe('alpha')
  })

  it('keeps everything else in an ellipsis menu: built-ins Duplicate, user themes Edit colors, Rename, Duplicate and Delete', async () => {
    await mountScreen({ ...TWO, [MOCK_SETTINGS_FILE]: '{ "theme": "alpha" }' })
    for (const id of ['dark', 'light', 'sepia', 'system']) {
      expect(await menuLabels(id), id).toEqual(['Duplicate'])
      await closeMenu()
    }
    for (const id of ['alpha', 'Zed']) {
      expect(await menuLabels(id), id).toEqual(['Edit colors', 'Rename', 'Duplicate', 'Delete'])
      await closeMenu()
    }
  })

  it('draws the menu trigger as a bare icon that says whose menu it is', async () => {
    await mountScreen(TWO)
    const trigger = item('Zed').querySelector<HTMLElement>('[data-theme-menu]')
    expect(trigger?.getAttribute('aria-label')).toBe('More actions for Zed')
    expect(trigger?.textContent.trim()).toBe('')
    expect(trigger?.querySelector('svg')).not.toBeNull()
    // No border and no background of its own, not even under the pointer.
    expect(trigger?.className).toContain('hover:bg-transparent')
    expect(trigger?.className).toContain('aria-expanded:bg-transparent')
    expect(trigger?.className).not.toContain('aria-expanded:bg-muted')
    expect(trigger?.className).not.toMatch(/\bborder-border\b|\bbg-background\b|\bbg-primary\b/)
  })

  it('lists a file that cannot be read, with the reason and only a Delete in its menu', async () => {
    await mountScreen({ [themeFile('Broken')]: '{ "colors": ' })
    expect(item('Broken').textContent).toContain('valid JSON')
    expect(item('Broken').querySelector('[data-theme-select]')).toBeNull()
    expect(await menuLabels('Broken')).toEqual(['Delete'])
  })
})

describe('ISC-484: where the focus goes when the menu closes', () => {
  it('returns to the ellipsis button after an item that opens no field', async () => {
    await mountScreen({ ...TWO, [MOCK_SETTINGS_FILE]: '{ "theme": "dark" }' })
    await pressMenu('alpha', 'edit')
    await flush()
    expect(document.activeElement).toBe(item('alpha').querySelector('[data-theme-menu]'))
  })
})

describe('ISC-485: the swatches say what each color is for', () => {
  async function hint(id: string, token: string): Promise<string> {
    const swatch = item(id).querySelector<HTMLElement>(`[data-theme-swatch="${token}"]`)
    if (swatch === null) throw new Error('no swatch ' + token)
    swatch.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }))
    await flush()
    const text = document.querySelector('[data-slot="tooltip-content"]')?.textContent ?? ''
    swatch.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }))
    await flush()
    return text.trim()
  }

  it.each([
    ['background', 'Background: behind the editor'],
    ['card', 'Card: panels and cards'],
    ['foreground', 'Foreground: the color of text'],
    ['primary', 'Primary: buttons, headings'],
    ['accent', 'Accent: the highlight under the pointer'],
  ])('names %s and what it is for', async (token, start) => {
    await mountScreen(TWO)
    expect(await hint('Zed', token)).toContain(start)
  })

  it('says the same on a built-in theme', async () => {
    await mountScreen(TWO)
    expect(await hint('dark', 'primary')).toContain('Primary: buttons, headings')
  })

  it('has the five swatches in that order, each with its token', async () => {
    await mountScreen(TWO)
    const tokens = [...item('Zed').querySelectorAll<HTMLElement>('[data-theme-swatch]')].map(
      (one) => one.dataset.themeSwatch,
    )
    expect(tokens).toEqual(['background', 'card', 'foreground', 'primary', 'accent'])
  })
})

const nameField = (): HTMLInputElement => {
  const field = document.querySelector<HTMLInputElement>('[data-theme-new-name]')
  if (field === null) throw new Error('no name field')
  return field
}

describe('ISC-474 and ISC-475: New theme and Duplicate', () => {
  async function openForm(): Promise<void> {
    await press(document.querySelector<HTMLElement>('[data-theme-new]'))
    expect(document.querySelector('[data-theme-new-form]')).not.toBeNull()
    scrolled.mockClear()
    formOpenAtScroll.length = 0
  }

  it('shows the form on the card colors: its text is --card-foreground, and the label follows it (ISC-503)', async () => {
    await mountScreen()
    await openForm()
    const form = document.querySelector<HTMLElement>('[data-theme-new-form]')
    expect(form?.classList.contains('bg-card')).toBe(true)
    expect(form?.classList.contains('text-card-foreground')).toBe(true)
    expect(nameField().closest('label')?.className).not.toMatch(/text-foreground/)
  })

  it('makes a theme from the chosen palette, selects it, closes the form and brings the editor up', async () => {
    await mountScreen()
    await openForm()
    await typeInto(nameField(), 'Moss')
    await press(document.querySelector<HTMLElement>('[data-theme-new-from="sepia"]'))
    expect(
      document.querySelector('[data-theme-new-from="sepia"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    await press(document.querySelector<HTMLElement>('[data-theme-new-create]'))
    expect(themeStems()).toEqual(['Moss'])
    expect(host.files.read(themeFile('Moss'))).toContain('"base": "sepia"')
    expect(settings.theme).toBe('Moss')
    expect(document.querySelector('[data-theme-new-form]')).toBeNull()
    expect(item('Moss').querySelector('[data-theme-in-use-mark]')).not.toBeNull()
    expect(scrolled).toHaveBeenCalledTimes(1)
    // The form is gone before the scroll is measured, or the heading would end up above the top.
    expect(formOpenAtScroll).toEqual([false])
  })

  it('keeps the form open and says why when the name is refused, and scrolls nowhere', async () => {
    await mountScreen()
    await openForm()
    await typeInto(nameField(), 'Dark')
    await press(document.querySelector<HTMLElement>('[data-theme-new-create]'))
    expect(document.querySelector('[data-theme-new-error]')?.textContent).toContain('built-in')
    expect(themeStems()).toEqual([])
    expect(scrolled).not.toHaveBeenCalled()
    await press(document.querySelector<HTMLElement>('[data-theme-new-cancel]'))
    expect(document.querySelector('[data-theme-new-form]')).toBeNull()
  })

  it('asks for the name of a copy, suggesting "<name> copy", and uses the one given', async () => {
    await mountScreen(TWO)
    await openMenu('light')
    await press(
      document.querySelector<HTMLElement>('[data-theme-menu-content] [data-theme-duplicate]'),
    )
    const form = document.querySelector<HTMLElement>('[data-theme-new-form]')
    expect(form?.dataset.themeFormKind).toBe('copy')
    expect(nameField().value).toBe('Light copy')
    // The menu closed, and the focus is in the name field, not back on the ellipsis button.
    expect(document.activeElement).toBe(nameField())
    expect(form?.querySelector('[data-theme-new-from]')).toBeNull()
    expect(document.querySelector('[data-theme-copy-of]')?.textContent).toContain('A copy of Light')
    expect(themeStems()).toEqual(['Zed', 'alpha'])
    await typeInto(nameField(), 'My own light')
    await press(document.querySelector<HTMLElement>('[data-theme-new-create]'))
    expect(themeStems()).toContain('My own light')
    expect(settings.theme).toBe('My own light')
    expect(parsedName('My own light')).toBe('My own light')
    expect(document.querySelector('[data-theme-new-form]')).toBeNull()
    expect(scrolled).toHaveBeenCalledTimes(2)
  })

  it('keeps the suggested name when it is left alone, and never touches the source', async () => {
    await mountScreen(TWO)
    await openMenu('alpha')
    await press(
      document.querySelector<HTMLElement>('[data-theme-menu-content] [data-theme-duplicate]'),
    )
    expect(nameField().value).toBe('alpha copy')
    await press(document.querySelector<HTMLElement>('[data-theme-new-create]'))
    expect(themeStems()).toContain('alpha copy')
    expect(host.files.read(themeFile('alpha'))).toBe(DARK_ONE)
  })

  it('refuses a bad or taken name with the reason, writes nothing, and Cancel closes the form', async () => {
    await mountScreen(TWO)
    await openMenu('alpha')
    await press(
      document.querySelector<HTMLElement>('[data-theme-menu-content] [data-theme-duplicate]'),
    )
    for (const [name, reason] of [
      ['', 'Name the theme'],
      ['sepia', 'built-in'],
      ['ZED', 'exists'],
    ] as const) {
      await typeInto(nameField(), name)
      await press(document.querySelector<HTMLElement>('[data-theme-new-create]'))
      expect(document.querySelector('[data-theme-new-error]')?.textContent, name).toContain(reason)
    }
    expect(themeStems()).toEqual(['Zed', 'alpha'])
    await press(document.querySelector<HTMLElement>('[data-theme-new-cancel]'))
    expect(document.querySelector('[data-theme-new-form]')).toBeNull()
    expect(themeStems()).toEqual(['Zed', 'alpha'])
  })

  it('opens from Customize above the colors for the theme in use, and a second request starts clean', async () => {
    await mountScreen({ [MOCK_SETTINGS_FILE]: '{ "theme": "sepia" }' })
    document.querySelector<HTMLElement>('[data-theme-customize]')?.click()
    await flush()
    expect(nameField().value).toBe('Sepia copy')
    await typeInto(nameField(), 'half typed')
    await press(document.querySelector<HTMLElement>('[data-theme-new-cancel]'))
    document.querySelector<HTMLElement>('[data-theme-customize]')?.click()
    await flush()
    expect(nameField().value).toBe('Sepia copy')
    await typeInto(nameField(), 'Warm')
    await press(document.querySelector<HTMLElement>('[data-theme-new-create]'))
    expect(themeStems()).toEqual(['Warm'])
    expect(parsedName('Warm')).toBe('Warm')
    expect(host.files.read(themeFile('Warm'))).toContain('"base": "sepia"')
  })

  it('scrolls the form into view when it opens', async () => {
    await mountScreen(TWO)
    await press(document.querySelector<HTMLElement>('[data-theme-new]'))
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(scrolled.mock.instances[0]).toBe(document.querySelector('[data-theme-new-form]'))
    expect(scrolled.mock.calls[0]?.[0]).toMatchObject({ block: 'center' })
  })
})

describe('ISC-481: the editor comes into view', () => {
  it('on Edit colors, to the top of the screen, and not on Select', async () => {
    await mountScreen({ ...TWO, [MOCK_SETTINGS_FILE]: '{ "theme": "dark" }' })
    await press(button('Zed', 'select'))
    expect(scrolled).not.toHaveBeenCalled()
    await pressMenu('alpha', 'edit')
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(scrolled.mock.instances[0]).toBe(
      document.querySelector('[data-settings-group-heading="Theme colors"]'),
    )
    expect(scrolled.mock.calls[0]?.[0]).toMatchObject({ block: 'start' })
    expect(settings.theme).toBe('alpha')
  })
})

describe('ISC-476: Rename in the list', () => {
  const field = (): HTMLInputElement => {
    const input = document.querySelector<HTMLInputElement>('[data-theme-rename-input]')
    if (input === null) throw new Error('no rename field')
    return input
  }
  const enter = async (): Promise<void> => {
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flush()
    await settledThemes()
    await flush()
  }

  it('turns the name into a field with the name in it, and Enter renames', async () => {
    await mountScreen(TWO)
    await pressMenu('Zed', 'rename')
    expect(field().value).toBe('Zed')
    expect(document.activeElement).toBe(field())
    await typeInto(field(), 'Zebra stripes')
    await enter()
    expect(themeStems()).toEqual(['Zebra stripes', 'alpha'])
    expect(settings.theme).toBe('Zebra stripes')
    expect(item('Zebra stripes').querySelector('[data-theme-name]')?.textContent.trim()).toBe(
      'Zebra stripes',
    )
    expect(document.querySelector('[data-theme-rename-input]')).toBeNull()
    expect(toasts.all).toEqual([])
  })

  it('shows the reason under the field for a taken name and keeps the field open', async () => {
    await mountScreen(TWO)
    await pressMenu('Zed', 'rename')
    await typeInto(field(), 'ALPHA')
    await enter()
    expect(document.querySelector('[data-theme-rename-error]')?.textContent).toContain('exists')
    expect(themeStems()).toEqual(['Zed', 'alpha'])
    expect(document.querySelector('[data-theme-rename-input]')).not.toBeNull()
  })

  it('drops the edit on Escape', async () => {
    await mountScreen(TWO)
    await pressMenu('Zed', 'rename')
    await typeInto(field(), 'Something else')
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    expect(document.querySelector('[data-theme-rename-input]')).toBeNull()
    expect(themeStems()).toEqual(['Zed', 'alpha'])
  })
})

describe('ISC-477: Delete in the list', () => {
  const dialog = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-theme-delete-dialog]')

  it('asks first, naming the theme, and Cancel changes nothing', async () => {
    await mountScreen(TWO)
    await pressMenu('alpha', 'delete')
    expect(dialog()?.textContent).toContain('Delete alpha?')
    expect(dialog()?.textContent).toContain('Recycle Bin')
    await press(document.querySelector<HTMLElement>('[data-theme-delete-cancel]'))
    expect(dialog()).toBeNull()
    expect(themeStems()).toEqual(['Zed', 'alpha'])
    expect(host.recycled).toEqual([])
  })

  it('sends the file to the bin on confirm', async () => {
    await mountScreen(TWO)
    await pressMenu('alpha', 'delete')
    await press(document.querySelector<HTMLElement>('[data-theme-delete-confirm]'))
    expect(themeStems()).toEqual(['Zed'])
    expect(host.recycled.map((one) => one.path)).toEqual([themeFile('alpha')])
    expect(ids()).not.toContain('alpha')
  })

  it('says Dark is used instead when the theme in use is deleted, and does it', async () => {
    await mountScreen(TWO)
    await pressMenu('Zed', 'delete')
    expect(dialog()?.textContent).toContain('Dark is used instead')
    await press(document.querySelector<HTMLElement>('[data-theme-delete-confirm]'))
    expect(settings.theme).toBe('dark')
    expect(item('dark').querySelector('[data-theme-in-use-mark]')).not.toBeNull()
  })

  it('keeps the theme in the list when there is no Recycle Bin', async () => {
    await mountScreen(TWO, { noRecycleBin: true })
    await pressMenu('alpha', 'delete')
    await press(document.querySelector<HTMLElement>('[data-theme-delete-confirm]'))
    expect(themeStems()).toEqual(['Zed', 'alpha'])
    expect(ids()).toContain('alpha')
    expect(toasts.last).toContain('Recycle Bin')
  })
})

describe('ISC-488 and ISC-489: the form for a new theme or a copy', () => {
  async function openNew(): Promise<HTMLElement> {
    await mountScreen()
    await press(document.querySelector<HTMLElement>('[data-theme-new]'))
    const form = document.querySelector<HTMLElement>('[data-theme-new-form]')
    if (form === null) throw new Error('no form')
    return form
  }

  it('has "Start from" as one toggle group with Dark on, and moving it moves the one on', async () => {
    const form = await openNew()
    const group = form.querySelector('[data-slot="toggle-group"]')
    expect(group?.getAttribute('aria-label')).toBe('Start from')
    const states = (): string[] =>
      [...form.querySelectorAll<HTMLElement>('[data-theme-new-from]')].map(
        (one) => `${one.dataset.themeNewFrom ?? ''}:${one.dataset.state ?? ''}`,
      )
    expect(states()).toEqual(['dark:on', 'light:off', 'sepia:off', 'current:off'])
    const dark = form.querySelector<HTMLElement>('[data-theme-new-from="dark"]')
    expect(dark?.className).toContain('data-[state=on]:bg-primary')
    await press(form.querySelector<HTMLElement>('[data-theme-new-from="sepia"]'))
    expect(states()).toEqual(['dark:off', 'light:off', 'sepia:on', 'current:off'])
    await press(form.querySelector<HTMLElement>('[data-theme-new-from="sepia"]'))
    expect(states()).toEqual(['dark:off', 'light:off', 'sepia:on', 'current:off'])
  })

  it('puts the field right after the label "Name", on the same line, in New theme', async () => {
    const form = await openNew()
    const label = form.querySelector('label')
    expect(label?.firstElementChild?.textContent).toBe('Name')
    expect(label?.textContent?.trim()).toBe('Name')
    expect(label?.children[1]).toBe(form.querySelector('[data-theme-new-name]'))
    expect(label?.className).toContain('flex')
    expect(label?.className).not.toContain('grid')
  })

  it('says "Name", not "Name of the copy", for a copy too', async () => {
    await mountScreen(TWO)
    await openMenu('light')
    await press(
      document.querySelector<HTMLElement>('[data-theme-menu-content] [data-theme-duplicate]'),
    )
    const label = document.querySelector('[data-theme-new-form] label')
    expect(label?.textContent?.trim()).toBe('Name')
    expect(label?.children[1]).toBe(document.querySelector('[data-theme-new-name]'))
    expect(document.body.textContent).not.toContain('Name of the copy')
  })
})

describe('ISC-511 and ISC-524: the Preview button at the Theme colors heading', () => {
  const button = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>('[data-theme-preview-open]')

  it('sits on the heading line of Theme colors and opens the preview beside Settings', async () => {
    await mountScreen()
    const heading = document.querySelector('[data-settings-group-heading="Theme colors"]')
    expect(heading?.textContent?.trim()).toBe('Theme colors')
    expect(button()).not.toBeNull()
    // The same line: the heading and the button share one parent.
    expect(heading?.parentElement?.contains(button())).toBe(true)
    expect(button()?.textContent?.trim()).toBe('Preview')

    button()?.click()
    await flush()
    const preview = themePreviewTabId()
    expect(preview).toBeDefined()
    const panes = panesOf(workbenchLayout.value)
    expect(panes).toHaveLength(2)
    expect(panes[1]?.tabs).toEqual([preview])
  })

  it('is there for a theme of the user too, and a second press shows the same tab', async () => {
    await mountScreen(TWO)
    expect(button()).not.toBeNull()
    button()?.click()
    await flush()
    const first = themePreviewTabId()
    button()?.click()
    await flush()
    expect(themePreviewTabId()).toBe(first)
    expect(panesOf(workbenchLayout.value)).toHaveLength(2)
  })

  it('is on no other page of Settings', async () => {
    await mountScreen()
    expect(document.querySelectorAll('[data-theme-preview-open]')).toHaveLength(1)
  })
})
