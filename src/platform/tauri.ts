import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Host, PerfConfig, PerfHost } from './host'

/** The Rust commands behind this exist only in `--features perf` builds. */
const perfBridge: PerfHost = {
  async config() {
    return invoke<PerfConfig>('perf_config')
  },
  async report(json) {
    await invoke('perf_report', { json })
  },
}

export const tauriHost: Host = {
  kind: 'tauri',
  async platformName() {
    return invoke<string>('platform_name')
  },
  async showWindow() {
    await getCurrentWindow().show()
  },
  async readFile(path) {
    return invoke<ArrayBuffer>('read_file', { path })
  },
  // Only `pnpm perf` sets the flag. A normal build drops the bridge and its command names.
  ...(import.meta.env.VITE_MDMATE_PERF ? { perf: perfBridge } : {}),
}
