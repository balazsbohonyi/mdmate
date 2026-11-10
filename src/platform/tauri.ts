import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { decodeFrame, encodeFrame, openedFromFrame } from './frame'
import type { DiskChange, Host, PerfConfig, PerfHost, SavedFile } from './host'
import { parseFollowedLink, parseLinkInfo } from './links'
import {
  parseCopyReport,
  parseDroppedItems,
  parseFileKind,
  parseImageInfo,
  parseMoved,
  parsePaths,
  parseTreeEntries,
  toCssPosition,
  type FileDragEvent,
} from './workspace'

/** The Rust commands behind this exist only in `--features perf` builds. */
const perfBridge: PerfHost = {
  async config() {
    return invoke<PerfConfig>('perf_config')
  },
  async report(json) {
    await invoke('perf_report', { json })
  },
  async ready(json) {
    await invoke('perf_ready', { json })
  },
  async grantFile(path) {
    await invoke('perf_grant_file', { path })
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
  assetUrl(path) {
    return convertFileSrc(path)
  },
  async describeLink(id, href) {
    return parseLinkInfo(await invoke<unknown>('describe_link', { id, href }))
  },
  async followLink(id, href, confirmed) {
    return parseFollowedLink(await invoke<unknown>('follow_link', { id, href, confirmed }))
  },
  async checkLinks(id, hrefs) {
    const answer = await invoke<unknown>('check_links', { id, hrefs })
    if (!Array.isArray(answer) || answer.length !== hrefs.length)
      throw new Error('bad check_links reply')
    return answer.map((missing) => missing === true)
  },
  async openFolder() {
    return invoke<string | null>('open_folder')
  },
  async loadWorkspace() {
    return parsePaths(await invoke<unknown>('workspace_load'))
  },
  async removeRoot(path) {
    await invoke('remove_root', { path })
  },
  async listDir(path) {
    return parseTreeEntries(await invoke<unknown>('list_dir', { path }))
  },
  async watchTree(onChange) {
    const channel = new Channel<string>()
    channel.onmessage = onChange
    await invoke('watch_tree', { onEvent: channel })
    // Rust keeps one channel, and subscribing again replaces it, so stopping only mutes this one.
    return () => {
      channel.onmessage = () => undefined
    }
  },
  async watchFolders(paths) {
    await invoke('watch_folders', { paths })
  },
  onFileDrag(handler) {
    return getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type === 'leave') {
        handler({ type: 'leave' })
        return
      }
      // Positions arrive in physical pixels; the page works in CSS pixels.
      const position = toCssPosition(payload.position, window.devicePixelRatio)
      const drag: FileDragEvent =
        payload.type === 'drop'
          ? { type: 'drop', position, paths: payload.paths }
          : { type: payload.type, position }
      handler(drag)
    })
  },
  async describeDrop(paths) {
    return parseDroppedItems(await invoke<unknown>('drop_describe', { paths }))
  },
  async openDropped(paths) {
    return parseDroppedItems(await invoke<unknown>('drop_open', { paths }))
  },
  async fileKind(path) {
    return parseFileKind(await invoke<unknown>('file_kind', { path }))
  },
  async imageInfo(path) {
    return parseImageInfo(await invoke<unknown>('image_info', { path }))
  },
  async imageClosed(path) {
    await invoke('image_closed', { path })
  },
  async addDroppedRoot(path) {
    return invoke<string>('add_dropped_root', { path })
  },
  async createFile(parent, name) {
    return invoke<string>('create_file', { parent, name })
  },
  async createFolder(parent, name) {
    return invoke<string>('create_folder', { parent, name })
  },
  async renameEntry(path, newName) {
    return parseMoved(await invoke<unknown>('rename_entry', { path, newName }))
  },
  async moveEntry(path, into) {
    return parseMoved(await invoke<unknown>('move_entry', { path, into }))
  },
  async deleteEntry(path) {
    await invoke('delete_entry', { path })
  },
  async revealEntry(path) {
    await invoke('reveal_entry', { path })
  },
  async copyClashes(into, paths) {
    return parsePaths(await invoke<unknown>('copy_clashes', { into, paths }))
  },
  async copyDropped(into, paths, answers) {
    return parseCopyReport(await invoke<unknown>('copy_dropped', { into, paths, answers }))
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
  async reloadDocument(id) {
    return openedFromFrame(decodeFrame(await invoke<ArrayBuffer>('reload_document', { id })))
  },
  async loadSession() {
    return invoke<string | null>('session_load')
  },
  async writeSession(json) {
    await invoke('session_write', new TextEncoder().encode(json))
  },
  async recoverBuffer(name, text) {
    return invoke<string>('session_recover', { name, text })
  },
  async watchClose(onClose) {
    const channel = new Channel<null>()
    channel.onmessage = onClose
    await invoke('watch_close', { onClose: channel })
  },
  async quitApp() {
    await invoke('quit_app')
  },
  async watchChanges(onChange) {
    const channel = new Channel<DiskChange>()
    channel.onmessage = onChange
    await invoke('watch_changes', { onEvent: channel })
    // Rust keeps one channel, and subscribing again replaces it, so stopping only mutes this one.
    return () => {
      channel.onmessage = () => undefined
    }
  },
  // Only `pnpm perf` sets the flag. A normal build drops the bridge and its command names.
  ...(import.meta.env.VITE_MDMATE_PERF ? { perf: perfBridge } : {}),
}
