import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

/**
 * The match a jump landed on (a folder search result), drawn in the Find bar's "current match"
 * color. The caret sits at the start of the match, and a caret alone shows nothing, least of all when
 * focus stayed in the results list, where the editor draws no selection at all. The mark goes away
 * on the next edit or the next move of the caret, so it never outlives the moment it points at.
 */

export interface RevealedRange {
  readonly from: number
  readonly to: number
}

/** Marks a range, or with null takes the mark away. */
export const revealMarkEffect = StateEffect.define<RevealedRange | null>()

const field = StateField.define<RevealedRange | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(revealMarkEffect)) return effect.value
    }
    // Anything that moves the caret or changes the text ends the mark. A scroll alone does not.
    return tr.docChanged || tr.selection !== undefined ? null : value
  },
})

const mark = Decoration.mark({ class: 'cm-md-reveal' })

const theme = EditorView.baseTheme({
  '.cm-md-reveal': { backgroundColor: 'var(--find-match-active)', borderRadius: '2px' },
})

/** The range the mark is on now, or null. */
export function revealedRange(state: EditorState): RevealedRange | null {
  return state.field(field, false) ?? null
}

export function revealMark(): Extension {
  return [
    field,
    EditorView.decorations.compute([field], (state) => {
      const range = state.field(field)
      if (range === null || range.from >= range.to) return Decoration.none
      const length = state.doc.length
      const from = Math.min(range.from, length)
      const to = Math.min(range.to, length)
      return from < to ? Decoration.set([mark.range(from, to)]) : Decoration.none
    }),
    theme,
  ]
}
