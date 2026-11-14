// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyTheme, THEME_CHOICES, themeClass } from '@/lib/themes'

describe('the themes a person can choose', () => {
  it('are Dark and Light', () => {
    expect(THEME_CHOICES.map((theme) => theme.value)).toEqual(['dark', 'light'])
  })

  it('put exactly one theme class on the root', () => {
    const root = document.createElement('html')
    root.className = 'dark other'
    applyTheme('light', root)
    expect(root.classList.contains('light')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.classList.contains('other')).toBe(true)
    applyTheme('dark', root)
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
  })

  it('show Dark for a name this build does not know', () => {
    expect(themeClass('sepia')).toBe('dark')
    expect(themeClass('my-own-theme')).toBe('dark')
  })
})
