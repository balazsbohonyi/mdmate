import { describe, expect, it } from 'vitest'
import { mockHost } from '@/platform/mock'

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
})
