import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Host } from './host'

export const tauriHost: Host = {
  kind: 'tauri',
  async platformName() {
    return invoke<string>('platform_name')
  },
  async showWindow() {
    await getCurrentWindow().show()
  },
}
