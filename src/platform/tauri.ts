import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { decodeFrame, encodeFrame, openedFromFrame } from './frame'
import type { Host, PerfConfig, PerfHost, SavedFile } from './host'

/** The Rust commands behind this exist only in `--features perf` builds. */
const perfBridge: PerfHost = {
  async config() {
    return invoke<PerfConfig>('perf_config')
  },
  async report(json) {
    await invoke('perf_report', { json })
  },
  assetUrl(path) {
    return convertFileSrc(path)
  },
  async allowAssetDirectory(path) {
    await invoke('perf_allow_directory', { path })
  },
  async toggleMaximize() {
    await invoke('perf_toggle_maximize')
  },
  async startDragging() {
    await invoke('perf_start_dragging')
  },
  async onDragDrop(handler) {
    return getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type === 'leave') handler({ type: 'leave' })
      else if (payload.type === 'over') handler({ type: 'over', position: payload.position })
      else {
        handler({
          type: payload.type,
          position: payload.position,
          paths: payload.paths,
        })
      }
    })
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
  windowControls: {
    async minimize() {
      await getCurrentWindow().minimize()
    },
    async toggleMaximize() {
      await getCurrentWindow().toggleMaximize()
    },
    async close() {
      await getCurrentWindow().close()
    },
    isMaximized() {
      return getCurrentWindow().isMaximized()
    },
    onMaximizedChange(handler) {
      const current = getCurrentWindow()
      // Maximizing and restoring both resize the window, and `isMaximized` tells them apart.
      return current.onResized(() => {
        current.isMaximized().then(handler, (error: unknown) => {
          console.error('Could not read the window state', error)
        })
      })
    },
  },
  async readFile(path) {
    return invoke<ArrayBuffer>('read_file', { path })
  },
  async pickFiles() {
    return invoke<string[]>('pick_files')
  },
  async openFile(path) {
    return openedFromFrame(decodeFrame(await invoke<ArrayBuffer>('open_file', { path })))
  },
  async saveFile(id, text, endings) {
    // The body is the frame; the id is a plain number, so the header stays ASCII.
    return invoke<SavedFile>('save_file', encodeFrame({}, endings, text), {
      headers: { 'x-document-id': String(id) },
    })
  },
  async closeDocument(id) {
    await invoke('close_document', { id })
  },
  // Only `pnpm perf` sets the flag. A normal build drops the bridge and its command names.
  ...(import.meta.env.VITE_MDMATE_PERF ? { perf: perfBridge } : {}),
}
