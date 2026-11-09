import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { looksLikeUrl } from './format'

/**
 * Pasting a web address over selected text makes a link: `[selected](address)`. Anything else
 * pastes as CodeMirror always does. The address is text the user put on the clipboard; what it may
 * do when followed is still decided by the link guard.
 *
 * This replaces `@codemirror/lang-markdown`'s own handler (switched off in `markdownSupport`),
 * which changes read-only documents and takes text with spaces as an address. Its check that the
 * selection is plain text is kept.
 */

/** Syntax a link cannot wrap: code, other links, images, HTML, markers. From lang-markdown. */
const NOT_PLAIN = /code|horizontalrule|html|link|comment|processing|escape|entity|image|mark|url/i

/** True when the selection is plain text that no syntax node starts or ends inside of. */
function selectsPlainText(state: EditorState, from: number, to: number): boolean {
  let plain = true
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.from > from || NOT_PLAIN.test(node.name)) plain = false
    },
    leave: (node) => {
      if (node.to < to) plain = false
    },
  })
  return plain
}

/** The link a paste of `text` over the selection makes, or null when it is an ordinary paste. */
export function pasteAsLink(state: EditorState, text: string): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const range = state.selection.main
  if (range.empty || !looksLikeUrl(text)) return null
  const selected = state.sliceDoc(range.from, range.to)
  // A paste over several lines, or across syntax (an address the parser already marks as one
  // included), is a plain paste.
  if (selected.includes('\n')) return null
  if (!selectsPlainText(state, range.from, range.to)) return null
  const insert = `[${selected}](${text.trim()})`
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
  }
}

/** The paste handler for a view. */
export function smartPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData('text/plain') ?? ''
      const spec = pasteAsLink(view.state, text)
      if (spec === null) return false
      event.preventDefault()
      view.dispatch(spec)
      return true
    },
  })
}
