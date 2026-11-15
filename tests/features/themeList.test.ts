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
import { openSettingsTab, resetWorkbench } from '@/workbench/store'
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

  it('offers each kind what fits it: built-ins Select and Duplicate, user themes also Edit, Rename and Delete', async () => {
    await mountScreen({ ...TWO, [MOCK_SETTINGS_FILE]: '{ "theme": "alpha" }' })
    for (const id of ['dark', 'light', 'sepia', 'system']) {
      expect(button(id, 'select'), `${id} select`).not.toBeNull()
      expect(button(id, 'duplicate'), `${id} duplicate`).not.toBeNull()
      expect(button(id, 'edit'), `${id} edit`).toBeNull()
      expect(button(id, 'rename'), `${id} rename`).toBeNull()
      expect(button(id, 'delete'), `${id} delete`).toBeNull()
    }
    for (const id of ['alpha', 'Zed']) {
      expect(button(id, 'edit'), `${id} edit`).not.toBeNull()
      expect(button(id, 'rename'), `${id} rename`).not.toBeNull()
      expect(button(id, 'duplicate'), `${id} duplicate`).not.toBeNull()
      expect(button(id, 'delete'), `${id} delete`).not.toBeNull()
    }
    // The theme in use has no Select.
    expect(button('alpha', 'select')).toBeNull()
    expect(button('Zed', 'select')).not.toBeNull()
  })

  it('lists a file that cannot be read, with the reason and a Delete', async () => {
    await mountScreen({ [themeFile('Broken')]: '{ "colors": ' })
    expect(item('Broken').textContent).toContain('valid JSON')
    expect(button('Broken', 'delete')).not.toBeNull()
    expect(button('Broken', 'rename')).toBeNull()
    expect(button('Broken', 'select')).toBeNull()
  })
})

describe('ISC-474 and ISC-475: New theme and Duplicate', () => {
  async function openForm(): Promise<void> {
    await press(document.querySelector<HTMLElement>('[data-theme-new]'))
    expect(document.querySelector('[data-theme-new-form]')).not.toBeNull()
  }
  const nameField = (): HTMLInputElement => {
    const field = document.querySelector<HTMLInputElement>('[data-theme-new-name]')
    if (field === null) throw new Error('no name field')
    return field
  }

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

  it('duplicates any row, selects the copy and brings the editor up', async () => {
    await mountScreen(TWO)
    await press(button('light', 'duplicate'))
    expect(themeStems()).toContain('Light copy')
    expect(settings.theme).toBe('Light copy')
    expect(scrolled).toHaveBeenCalledTimes(1)
    await press(button('alpha', 'duplicate'))
    expect(themeStems()).toContain('alpha copy')
    expect(host.files.read(themeFile('alpha'))).toBe(DARK_ONE)
  })
})

describe('ISC-481: the editor comes into view', () => {
  it('on Edit colors, to the top of the screen, and not on Select', async () => {
    await mountScreen({ ...TWO, [MOCK_SETTINGS_FILE]: '{ "theme": "dark" }' })
    await press(button('Zed', 'select'))
    expect(scrolled).not.toHaveBeenCalled()
    await press(button('alpha', 'edit'))
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
    await press(button('Zed', 'rename'))
    expect(field().value).toBe('Zed')
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
    await press(button('Zed', 'rename'))
    await typeInto(field(), 'ALPHA')
    await enter()
    expect(document.querySelector('[data-theme-rename-error]')?.textContent).toContain('exists')
    expect(themeStems()).toEqual(['Zed', 'alpha'])
    expect(document.querySelector('[data-theme-rename-input]')).not.toBeNull()
  })

  it('drops the edit on Escape', async () => {
    await mountScreen(TWO)
    await press(button('Zed', 'rename'))
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
    await press(button('alpha', 'delete'))
    expect(dialog()?.textContent).toContain('Delete alpha?')
    expect(dialog()?.textContent).toContain('Recycle Bin')
    await press(document.querySelector<HTMLElement>('[data-theme-delete-cancel]'))
    expect(dialog()).toBeNull()
    expect(themeStems()).toEqual(['Zed', 'alpha'])
    expect(host.recycled).toEqual([])
  })

  it('sends the file to the bin on confirm', async () => {
    await mountScreen(TWO)
    await press(button('alpha', 'delete'))
    await press(document.querySelector<HTMLElement>('[data-theme-delete-confirm]'))
    expect(themeStems()).toEqual(['Zed'])
    expect(host.recycled.map((one) => one.path)).toEqual([themeFile('alpha')])
    expect(ids()).not.toContain('alpha')
  })

  it('says Dark is used instead when the theme in use is deleted, and does it', async () => {
    await mountScreen(TWO)
    await press(button('Zed', 'delete'))
    expect(dialog()?.textContent).toContain('Dark is used instead')
    await press(document.querySelector<HTMLElement>('[data-theme-delete-confirm]'))
    expect(settings.theme).toBe('dark')
    expect(item('dark').querySelector('[data-theme-in-use-mark]')).not.toBeNull()
  })

  it('keeps the theme in the list when there is no Recycle Bin', async () => {
    await mountScreen(TWO, { noRecycleBin: true })
    await press(button('alpha', 'delete'))
    await press(document.querySelector<HTMLElement>('[data-theme-delete-confirm]'))
    expect(themeStems()).toEqual(['Zed', 'alpha'])
    expect(ids()).toContain('alpha')
    expect(toasts.last).toContain('Recycle Bin')
  })
})
