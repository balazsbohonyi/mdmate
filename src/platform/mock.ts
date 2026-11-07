import type { Host } from './host'

/** Browser stand-in, so UI work runs under pnpm dev with no Rust. */
export const mockHost: Host = {
  kind: 'browser',
  platformName() {
    return Promise.resolve('browser')
  },
  showWindow() {
    return Promise.resolve()
  },
  readFile() {
    return Promise.reject(new Error('Reading files needs the desktop app.'))
  },
}
