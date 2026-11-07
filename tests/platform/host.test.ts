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
})
