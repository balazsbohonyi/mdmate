import { history, redo, undo } from '@codemirror/commands'
import {
  EditorSelection,
  EditorState,
  type Extension,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
import { endingsOf, lineEndingsFor } from '@/editor/lineEndings'
import { ENDING_TEXT, type EndingCode, type Endings } from '@/lib/endings'

/** Splits raw text like the Rust side does: `\n`-only text, and the ending of every break. */
export function splitRaw(raw: string): { text: string; endings: Endings } {
  const breaks = raw.match(/\r\n|\n|\r/g) ?? []
  const codes: EndingCode[] = breaks.map((b) => (b === '\n' ? 0 : b === '\r\n' ? 1 : 2))
  const counts = [0, 0, 0]
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1
  // The most common ending is the dominant one; the first to appear wins a tie; LF when no breaks.
  let dominant: EndingCode = codes[0] ?? 0
  for (const code of [0, 1, 2] as const) {
    if ((counts[code] ?? 0) > (counts[dominant] ?? 0)) dominant = code
  }
  const at: number[] = []
  const kept: EndingCode[] = []
  codes.forEach((code, i) => {
    if (code === dominant) return
    at.push(i)
    kept.push(code)
  })
  return { text: raw.split(/\r\n|\n|\r/).join('\n'), endings: { dominant, at, codes: kept } }
}

/** The raw text a save would write for this text and these endings. */
export function joinRaw(text: string, endings: Endings): string {
  const lines = text.split('\n')
  let next = 0
  return lines
    .map((line, i) => {
      if (i === lines.length - 1) return line
      const exception = endings.at[next] === i
      const code = exception ? (endings.codes[next] ?? endings.dominant) : endings.dominant
      if (exception) next += 1
      return line + ENDING_TEXT[code]
    })
    .join('')
}

/** A state holding `raw` as the page would: clean text, its endings beside it, undo history. */
export function openRaw(raw: string, extensions: Extension = []): EditorState {
  const { text, endings } = splitRaw(raw)
  return EditorState.create({
    doc: text,
    extensions: [history(), lineEndingsFor(endings), extensions],
  })
}

/** The raw text this state would save as. */
export function saveRaw(state: EditorState): string {
  return joinRaw(state.doc.toString(), endingsOf(state))
}

/** Runs a history command and returns the state after it, or null when it had nothing to do. */
export function runHistory(state: EditorState, command: StateCommand): EditorState | null {
  const steps: Transaction[] = []
  const ran = command({ state, dispatch: (tr) => void steps.push(tr) })
  return ran ? (steps[0]?.state ?? null) : null
}

export const undoOn = (state: EditorState): EditorState | null => runHistory(state, undo)
export const redoOn = (state: EditorState): EditorState | null => runHistory(state, redo)

/** The same state with `from` to `to` selected. */
export function select(state: EditorState, from: number, to: number): EditorState {
  return state.update({ selection: EditorSelection.single(from, to) }).state
}
