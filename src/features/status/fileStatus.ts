import type { EditorState, Text } from '@codemirror/state'
import { shallowRef, watch } from 'vue'
import { documentOfTab, watchDocuments } from '@/documents/store'
import type { Document } from '@/documents/document'
import { languageNameForFile } from '@/editor/codeLanguages'
import { columnAt } from '@/editor/goToLine'
import { textStats } from '@/editor/textStats'
import { CR, CRLF, LF, type EndingCode, type Endings } from '@/lib/endings'
import type { OpenedFile } from '@/platform'
import { findPane } from '@/workbench/splitTree'
import { workbenchLayout } from '@/workbench/store'

/**
 * What the status bar says about the file in the focused tab, as plain data: no editor object goes
 * into Vue. A key only asks for the next frame. Counting words and selected characters waits for a
 * pause, and a very long text is counted a part at a time.
 */
export interface FileStatus {
  readonly line: number
  readonly column: number
  /** Null while nothing is selected, and until a new selection has been counted. */
  readonly selection: { readonly chars: number; readonly lines: number } | null
  /** Words of the selection, or of the file while nothing is selected. Markdown only. */
  readonly words: number | null
  readonly eol: string
  readonly encoding: string
  /** Empty until the language of the name has been looked up. */
  readonly language: string
}

export const STATUS_COUNT_DELAY_MS = 250

/**
 * How many parts of a text (up to 32 lines each) one turn counts, kept small since a key waits for
 * the turn under way. `typing-status` reports what a turn costs.
 */
export const LEAVES_PER_TURN = 80

const EOL_NAMES: Record<EndingCode, string> = { [LF]: 'LF', [CRLF]: 'CRLF', [CR]: 'CR' }

const ENCODING_NAMES: Record<OpenedFile['encoding'], string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  unsupported: 'Unknown encoding',
}

export const fileStatus = shallowRef<FileStatus | null>(null)

/** One name for every line break of the file, or `Mixed`. */
function eolName(endings: Endings, breaks: number): string {
  if (endings.at.length === 0) return EOL_NAMES[endings.dominant]
  const [first] = endings.codes
  // Some breaks are the usual ending and some are not.
  if (endings.at.length < breaks || first === undefined) return 'Mixed'
  return endings.codes.every((code) => code === first) ? EOL_NAMES[first] : 'Mixed'
}

/** Language names by file name; empty while one is being looked up. */
const languages = new Map<string, string>()

function languageName(doc: Document, found: () => void): string {
  if (doc.kind === 'markdown') return 'Markdown'
  const name = doc.name
  const kept = languages.get(name)
  if (kept !== undefined) return kept
  languages.set(name, '')
  void languageNameForFile(name).then(
    (language) => {
      languages.set(name, language ?? 'Plain Text')
      found()
    },
    () => languages.delete(name),
  )
  return ''
}

interface Target {
  readonly doc: Document
  readonly state: EditorState
}

/** The document in the focused tab and the state that tab shows, or null for any other tab. */
function target(): Target | null {
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab ?? null
  const doc = tab === null ? undefined : documentOfTab(tab)
  if (tab === null || doc === undefined) return null
  return { doc, state: doc.followerFor(tab).state }
}

/** What the counts on show were made from. */
interface Counted {
  readonly text: Text
  readonly from: number
  readonly to: number
  readonly selection: FileStatus['selection']
  readonly words: number | null
}

/** Starts reporting. Returns the function that stops it. */
export function watchFileStatus(): () => void {
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let counted: Counted | null = null

  const countIn = (delay: number): void => {
    clearTimeout(timer)
    timer = setTimeout(count, delay)
  }

  /** The counts for what the focused tab shows now. */
  function count(): void {
    const shown = target()
    if (shown === null) return
    const { doc, state } = shown
    const { from, to } = state.selection.main
    const budget = { leaves: LEAVES_PER_TURN }
    const stats =
      from === to && doc.kind !== 'markdown'
        ? { words: 0, wide: 0 }
        : textStats(from === to ? state.doc : state.doc.slice(from, to), budget)
    if (stats === null) {
      countIn(0)
      return
    }
    const last = state.doc.lineAt(to)
    // A selection that ends at the start of a line has nothing of that line.
    const lines = last.number - state.doc.lineAt(from).number + (to === last.from ? 0 : 1)
    counted = {
      text: state.doc,
      from,
      to,
      selection: from === to ? null : { chars: to - from - stats.wide, lines },
      words: doc.kind === 'markdown' ? stats.words : null,
    }
    update()
  }

  function update(): void {
    frame = undefined
    const shown = target()
    if (shown === null) {
      clearTimeout(timer)
      counted = null
      fileStatus.value = null
      return
    }
    const { doc, state } = shown
    const { from, to, head } = state.selection.main
    const current =
      counted !== null && counted.text === state.doc && counted.from === from && counted.to === to
    if (!current) countIn(STATUS_COUNT_DELAY_MS)
    const markdown = doc.kind === 'markdown'
    const before = fileStatus.value
    fileStatus.value = {
      line: state.doc.lineAt(head).number,
      column: columnAt(state.doc, head),
      // The last counts stay until the new ones are in, so the bar does not blink while typing.
      selection: from === to ? null : (counted?.selection ?? null),
      words: markdown ? (counted?.words ?? before?.words ?? null) : null,
      eol: eolName(doc.endings(), doc.master.doc.lines - 1),
      encoding: ENCODING_NAMES[doc.encoding],
      language: languageName(doc, later),
    }
  }

  function later(): void {
    frame ??= requestAnimationFrame(update)
  }

  const stops = [
    watchDocuments(later),
    // A different tab or pane: nothing counted for the old one carries over.
    watch(
      () => {
        const layout = workbenchLayout.value
        return findPane(layout, layout.activePane)?.activeTab ?? null
      },
      () => {
        counted = null
        fileStatus.value = null
        later()
      },
    ),
  ]
  later()

  return () => {
    for (const stop of stops) stop()
    clearTimeout(timer)
    if (frame !== undefined) cancelAnimationFrame(frame)
    fileStatus.value = null
  }
}
