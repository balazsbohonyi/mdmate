import { beforeEach, vi } from 'vitest'
import { toasts } from './toasts'

// Every test file gets the recording report functions. A test that wants the real ones (the toast
// module's own) asks for them with `vi.importActual`.
vi.mock('@/shell/toasts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shell/toasts')>()),
  reportError: (message: string) => {
    toasts.record('error', message)
  },
  reportWarning: (message: string) => {
    toasts.record('warning', message)
  },
}))

beforeEach(() => {
  toasts.clear()
})
