import type { Host } from './host'

export type {
  DiskChange,
  Host,
  OpenedFile,
  PerfConfig,
  PerfDragDrop,
  PerfHost,
  ReadOnlyReason,
  SavedFile,
  WindowControls,
} from './host'

let host: Promise<Host> | undefined

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

async function loadHost(): Promise<Host> {
  if (isTauri()) {
    const { tauriHost } = await import('./tauri')
    return tauriHost
  }
  const { mockHost } = await import('./mock')
  return mockHost
}

/** The host for this runtime. Tauri code loads only inside the real app. */
export function getHost(): Promise<Host> {
  host ??= loadHost()
  return host
}

/** Replaces the host, so a test can hand the app a host with files it controls. */
export function setHost(replacement: Host | undefined): void {
  host = replacement === undefined ? undefined : Promise.resolve(replacement)
}
