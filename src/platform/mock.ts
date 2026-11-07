import type { Host, WindowControls } from './host'

/**
 * Window controls for the browser. Maximize flips a flag so the title bar's icon can be seen
 * changing under pnpm dev; minimize and close do nothing, since a tab is not a window.
 */
function mockWindowControls(): WindowControls {
  let maximized = false
  const listeners = new Set<(maximized: boolean) => void>()
  return {
    minimize() {
      return Promise.resolve()
    },
    toggleMaximize() {
      maximized = !maximized
      for (const listener of listeners) listener(maximized)
      return Promise.resolve()
    },
    close() {
      return Promise.resolve()
    },
    isMaximized() {
      return Promise.resolve(maximized)
    },
    onMaximizedChange(handler) {
      listeners.add(handler)
      return Promise.resolve(() => {
        listeners.delete(handler)
      })
    },
  }
}

/** Browser stand-in, so UI work runs under pnpm dev with no Rust. */
export const mockHost: Host = {
  kind: 'browser',
  platformName() {
    return Promise.resolve('browser')
  },
  showWindow() {
    return Promise.resolve()
  },
  windowControls: mockWindowControls(),
  readFile() {
    return Promise.reject(new Error('Reading files needs the desktop app.'))
  },
}
