// @vitest-environment jsdom
/**
 * The font picker (P9.1-T25, ISC-642, ISC-643): the field stays a text field, and a list of the
 * installed families helps. The component is mounted on its own with a small parent that plays the
 * part of the Settings screen (a draft, accept and revert); the Settings screen itself is in
 * `settingsView.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import FontPicker from '@/features/settings/FontPicker.vue'
import { fontFamilies, resetFontFamilies } from '@/features/settings/fontList'
import { setHost } from '@/platform'
import { createMockHost, MOCK_FONT_FAMILIES } from '@/platform/mock'

const FONTS = ['Arial', 'Cascadia Code', 'Georgia', 'Inter', 'Segoe UI']

let app: App | undefined
let root: HTMLElement | undefined

interface Log {
  updates: string[]
  accepts: number
  reverts: number
  opens: number
  /** What the field holds when `accept` fires. */
  accepted: string[]
}

/** Mounts the picker under a parent that keeps the typed text, as the Settings screen does. */
function mount(
  initial = '',
  fonts: readonly string[] | null = FONTS,
): { log: Log; text: () => string } {
  const log: Log = { updates: [], accepts: 0, reverts: 0, opens: 0, accepted: [] }
  const text = ref(initial)
  const Parent = defineComponent({
    render: () =>
      h(FontPicker, {
        modelValue: text.value,
        label: 'Body font',
        invalid: false,
        fonts,
        'onUpdate:modelValue': (value: string) => {
          log.updates.push(value)
          text.value = value
        },
        onAccept: () => {
          log.accepts++
          log.accepted.push(text.value)
        },
        onRevert: () => {
          log.reverts++
        },
        onOpen: () => {
          log.opens++
        },
      }),
  })
  root = document.createElement('div')
  document.body.append(root)
  app = createApp(Parent)
  app.mount(root)
  return { log, text: () => text.value }
}

const input = (): HTMLInputElement => {
  const found = root?.querySelector<HTMLInputElement>('input')
  if (found === null || found === undefined) throw new Error('no field')
  return found
}
const list = (): HTMLElement | null => root?.querySelector<HTMLElement>('[data-font-list]') ?? null
const options = (): HTMLElement[] => [
  ...(root?.querySelectorAll<HTMLElement>('[data-font-option]') ?? []),
]
const names = (): string[] => options().map((option) => option.textContent.trim())

async function focus(): Promise<void> {
  input().dispatchEvent(new FocusEvent('focus'))
  await nextTick()
}
async function type(text: string): Promise<void> {
  input().value = text
  input().dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
async function key(name: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  input().dispatchEvent(event)
  await nextTick()
  return event
}

beforeEach(() => {
  resetFontFamilies()
})

afterEach(() => {
  app?.unmount()
  root?.remove()
  app = undefined
  root = undefined
  setHost(undefined)
  vi.restoreAllMocks()
})

describe('the list of families (ISC-642)', () => {
  it('stays closed until the field is used, and asks the parent for the list when it opens', async () => {
    const { log } = mount()
    expect(list()).toBeNull()
    expect(log.opens).toBe(0)
    await focus()
    expect(list()).not.toBeNull()
    expect(log.opens).toBe(1)
  })

  it('puts Built-in first and then every family, A to Z as given', async () => {
    mount()
    await focus()
    expect(names()).toEqual(['Built-in', ...FONTS])
    expect(options()[0]?.hasAttribute('data-font-built-in')).toBe(true)
  })

  it('draws each option in its own family', async () => {
    mount()
    await focus()
    const georgia = options().find((option) => option.dataset.fontName === 'Georgia')
    expect(georgia?.style.fontFamily).toContain('Georgia')
    const segoe = options().find((option) => option.dataset.fontName === 'Segoe UI')
    expect(segoe?.style.fontFamily).toContain('Segoe UI')
    // Built-in is drawn in the app's own font, not in a family of its own.
    expect(options()[0]?.style.fontFamily).toBe('')
  })

  it('lists every family while the field is only opened, even with a saved value in it', async () => {
    mount('Georgia')
    await focus()
    expect(names()).toEqual(['Built-in', ...FONTS])
  })

  it('narrows the list to what is typed, whatever the case', async () => {
    mount()
    await focus()
    await type('SEG')
    expect(names()).toEqual(['Built-in', 'Segoe UI'])
    await type('a')
    expect(names()).toEqual(['Built-in', 'Arial', 'Cascadia Code', 'Georgia'])
  })

  it('says so when nothing matches, and keeps Built-in', async () => {
    mount()
    await focus()
    await type('zzz')
    expect(names()).toEqual(['Built-in'])
    expect(root?.querySelector('[data-font-none]')?.textContent).toContain('used as typed')
  })

  it('says so when the system has no fonts to list', async () => {
    mount('', [])
    await focus()
    expect(root?.querySelector('[data-font-none]')?.textContent).toContain('No installed fonts')
  })

  it('draws a capped part of a long list and says how many more there are', async () => {
    const many = Array.from({ length: 150 }, (_, at) => `Family ${String(at).padStart(3, '0')}`)
    mount('', many)
    await focus()
    // Built-in and 60 families.
    expect(options()).toHaveLength(61)
    expect(root?.querySelector('[data-font-more]')?.textContent).toContain('90 more')
    await type('Family 14')
    expect(options()).toHaveLength(11)
    expect(root?.querySelector('[data-font-more]')).toBeNull()
  })

  it('waits for the list: nothing is drawn until the parent has it', async () => {
    const { log } = mount('', null)
    await focus()
    expect(list()).toBeNull()
    expect(log.opens).toBe(1)
  })
})

describe('picking, clearing and typing (ISC-642)', () => {
  it('picks a family: the field takes it, it is accepted at once, and the list closes', async () => {
    const { log, text } = mount()
    await focus()
    options()
      .find((option) => option.dataset.fontName === 'Inter')
      ?.click()
    await nextTick()
    expect(text()).toBe('Inter')
    expect(log.accepted).toEqual(['Inter'])
    expect(list()).toBeNull()
  })

  it('picks Built-in: the field is emptied and accepted, which clears the setting', async () => {
    const { log, text } = mount('Georgia')
    await focus()
    options()[0]?.click()
    await nextTick()
    expect(text()).toBe('')
    expect(log.accepted).toEqual([''])
  })

  it('accepts a name that is not in the list, as typed, on Enter and on leaving the field', async () => {
    const { log, text } = mount()
    await focus()
    await type('My Own Font')
    expect(text()).toBe('My Own Font')
    expect(log.accepts).toBe(0)
    await key('Enter')
    expect(log.accepted).toEqual(['My Own Font'])
    expect(list()).toBeNull()
    await type('Another One')
    input().dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(log.accepted).toEqual(['My Own Font', 'Another One'])
  })

  it('takes a typed stack as it is', async () => {
    const { log } = mount()
    await focus()
    await type('Inter, sans-serif')
    await key('Enter')
    expect(log.accepted).toEqual(['Inter, sans-serif'])
  })

  it('walks the options with the arrow keys and picks the one it is on with Enter', async () => {
    const { log } = mount()
    await focus()
    await key('ArrowDown')
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-0$/)
    await key('ArrowDown')
    await key('ArrowDown')
    expect(options()[2]?.getAttribute('data-font-name')).toBe('Cascadia Code')
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-2$/)
    await key('Enter')
    expect(log.accepted).toEqual(['Cascadia Code'])
  })

  it('wraps from the last option to Built-in, and back', async () => {
    mount()
    await focus()
    await key('ArrowUp')
    expect(input().getAttribute('aria-activedescendant')).toMatch(
      new RegExp(`-${String(FONTS.length)}$`),
    )
    await key('ArrowDown')
    expect(input().getAttribute('aria-activedescendant')).toMatch(/-0$/)
  })

  it('opens with the arrow key when it has been closed', async () => {
    mount()
    await key('ArrowDown')
    expect(list()).not.toBeNull()
  })

  it('drops the typed text on Escape and closes the list', async () => {
    const { log } = mount()
    await focus()
    await type('Geo')
    await key('Escape')
    expect(log.reverts).toBe(1)
    expect(list()).toBeNull()
    expect(log.accepts).toBe(0)
  })

  it('closes when the field is left, with nothing accepted by the list itself', async () => {
    const { log } = mount()
    await focus()
    input().dispatchEvent(new FocusEvent('blur'))
    await nextTick()
    expect(list()).toBeNull()
    expect(log.accepts).toBe(0)
    expect(log.updates).toEqual([])
  })

  it('marks the option that is the value now', async () => {
    mount('georgia')
    await focus()
    const marked = options().filter((option) => option.getAttribute('aria-selected') === 'true')
    expect(marked.map((option) => option.dataset.fontName)).toEqual(['Georgia'])
  })

  it('is a combobox for a screen reader, and flags a refused value', async () => {
    mount()
    expect(input().getAttribute('role')).toBe('combobox')
    expect(input().getAttribute('aria-label')).toBe('Body font')
    expect(input().getAttribute('aria-expanded')).toBe('false')
    await focus()
    expect(input().getAttribute('aria-expanded')).toBe('true')
    expect(list()?.getAttribute('role')).toBe('listbox')
  })
})

describe('a saved value is shown as it is and kept (ISC-643)', () => {
  it('shows a saved stack as written, and opening and closing the list changes nothing', async () => {
    const { log, text } = mount('Inter, sans-serif')
    expect(input().value).toBe('Inter, sans-serif')
    await focus()
    input().dispatchEvent(new FocusEvent('blur'))
    await nextTick()
    expect(text()).toBe('Inter, sans-serif')
    expect(log.updates).toEqual([])
    expect(log.accepts).toBe(0)
  })

  it('shows a family that is not installed as written, too', async () => {
    const { log, text } = mount('Not Installed Anywhere')
    expect(input().value).toBe('Not Installed Anywhere')
    await focus()
    input().dispatchEvent(new FocusEvent('blur'))
    await nextTick()
    expect(text()).toBe('Not Installed Anywhere')
    expect(log.updates).toEqual([])
  })
})

describe('reading the families once (ISC-641)', () => {
  it('asks the host the first time and keeps the answer', async () => {
    const host = createMockHost()
    const ask = vi.spyOn(host, 'listFontFamilies')
    setHost(host)
    expect(await fontFamilies()).toEqual(MOCK_FONT_FAMILIES)
    expect(await fontFamilies()).toEqual(MOCK_FONT_FAMILIES)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('answers an empty list when the host cannot, and asks again the next time', async () => {
    const host = createMockHost()
    const ask = vi.spyOn(host, 'listFontFamilies').mockRejectedValueOnce(new Error('not available'))
    setHost(host)
    expect(await fontFamilies()).toEqual([])
    expect(await fontFamilies()).toEqual(MOCK_FONT_FAMILIES)
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
