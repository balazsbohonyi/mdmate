import type { Host } from './host'

export type {
  DiskChange,
  Host,
  OpenedFile,
  PerfConfig,
  PerfDragDrop,
  PerfHost,
  ReadOnlyReason,
  RecentLists,
  SaveAsHint,
  SavedAs,
  SavedFile,
  WindowControls,
} from './host'
export type { FollowedLink, LinkInfo, LinkRefusal } from './links'
export type { Reference, ReferenceProblem, ReferencesFound } from './references'
export type { OutlineAnswer, OutlineHeading, OutlineRequest } from './outline'
export { MAX_OUTLINE_HEADINGS } from './outline'
export type { SearchBatch, SearchHit, SearchRequest, SearchSummary } from './search'
export { MAX_SEARCH_HITS } from './search'
export type {
  ClashAnswer,
  ClashChoice,
  CopyReport,
  DroppedItem,
  DropKind,
  EntryKind,
  FileDragEvent,
  FileKind,
  ImageInfo,
  Moved,
  MovedDocument,
  Point,
  TreeEntry,
} from './workspace'

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
