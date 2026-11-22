import { describe, expect, it } from 'vitest'
import { createMockHost, MOCK_FONT_FAMILIES, mockHost } from '@/platform/mock'

describe('mock host', () => {
  it('reports the browser runtime', async () => {
    expect(mockHost.kind).toBe('browser')
    expect(await mockHost.platformName()).toBe('browser')
  })

  it('shows the window without touching a native API', async () => {
    await expect(mockHost.showWindow()).resolves.toBeUndefined()
  })

  it('maximizes and restores, and tells listeners each time until they stop', async () => {
    const { windowControls } = mockHost
    const seen: boolean[] = []
    const stop = await windowControls.onMaximizedChange((maximized) => seen.push(maximized))

    expect(await windowControls.isMaximized()).toBe(false)
    await windowControls.toggleMaximize()
    expect(await windowControls.isMaximized()).toBe(true)
    await windowControls.toggleMaximize()
    expect(await windowControls.isMaximized()).toBe(false)
    expect(seen).toEqual([true, false])

    stop()
    await windowControls.toggleMaximize()
    await windowControls.toggleMaximize()
    expect(seen).toEqual([true, false])
  })

  it('treats minimize and close as no-ops in a browser tab', async () => {
    await expect(mockHost.windowControls.minimize()).resolves.toBeUndefined()
    await expect(mockHost.windowControls.close()).resolves.toBeUndefined()
  })

  it('picks a program: the path the dialog gives, and null when it is cancelled (ISC-666)', async () => {
    expect(await mockHost.pickExecutable()).toBeNull()
    const picked = createMockHost({ pickExecutable: () => 'C:/Program Files/Git/cmd/git.exe' })
    expect(await picked.pickExecutable()).toBe('C:/Program Files/Git/cmd/git.exe')
  })

  it('lists the installed font families: each once, sorted, with no empty name (ISC-641)', async () => {
    const families = await mockHost.listFontFamilies()
    expect(families).toEqual(MOCK_FONT_FAMILIES)
    expect(families.length).toBeGreaterThan(0)
    expect(families.every((name) => name.trim() !== '')).toBe(true)
    expect(new Set(families.map((name) => name.toLowerCase())).size).toBe(families.length)
    expect([...families].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))).toEqual(
      families,
    )
  })
})
