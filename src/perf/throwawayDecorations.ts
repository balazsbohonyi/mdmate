/**
 * THROWAWAY (P0-T8). Delete this file when Phase 3 builds the real live preview.
 *
 * It exists to answer one question: what do inline live-preview decorations cost per key on a
 * 1 MB document? So it does what the real inline layer will do, and nothing else:
 * - style headings, strong, emphasis and inline code;
 * - hide their syntax marks (`#`, `*`, backticks) except where the caret is, so the marks come
 *   back when you move into them;
 * - rebuild when the document, viewport, selection or parse tree changes, over the visible
 *   ranges only.
 * It has no block widgets (tables, images, frontmatter). Those are a later measurement.
 */
import { syntaxTree } from '@codemirror/language'
import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { PerfParams } from './params'

const hide = Decoration.replace({})
const strong = Decoration.mark({ class: 'tw-strong' })
const emphasis = Decoration.mark({ class: 'tw-em' })
const code = Decoration.mark({ class: 'tw-code' })
const headingLines = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `tw-h tw-h${String(level)}` }),
)

const theme = EditorView.baseTheme({
  '.tw-strong': { fontWeight: '700' },
  '.tw-em': { fontStyle: 'italic' },
  '.tw-code': {
    fontFamily: 'ui-monospace, Consolas, monospace',
    backgroundColor: 'var(--muted)',
  },
  '.tw-h': { fontWeight: '700' },
  '.tw-h1': { fontSize: '1.7em' },
  '.tw-h2': { fontSize: '1.45em' },
  '.tw-h3': { fontSize: '1.25em' },
  '.tw-h4': { fontSize: '1.1em' },
})

function build(view: EditorView): DecorationSet {
  const { state } = view
  const caret = state.selection.main
  const caretLine = { from: state.doc.lineAt(caret.from).from, to: state.doc.lineAt(caret.to).to }
  const touchesCaret = (from: number, to: number) => from <= caret.to && to >= caret.from
  const ranges: Range<Decoration>[] = []
  const tree = syntaxTree(state)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const name = node.name
        if (name.startsWith('ATXHeading')) {
          const level = Math.min(6, Number(name.slice('ATXHeading'.length)) || 1)
          const line = state.doc.lineAt(node.from)
          const decoration = headingLines[level - 1]
          if (decoration) ranges.push(decoration.range(line.from))
        } else if (name === 'HeaderMark') {
          // Hide the hashes and the space after them, unless the caret is on this heading.
          const line = state.doc.lineAt(node.from)
          const reveal =
            touchesCaret(line.from, line.to) ||
            (caretLine.from <= line.from && line.to <= caretLine.to)
          if (!reveal) {
            const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
            ranges.push(hide.range(node.from, end))
          }
        } else if (name === 'StrongEmphasis') {
          ranges.push(strong.range(node.from, node.to))
        } else if (name === 'Emphasis') {
          ranges.push(emphasis.range(node.from, node.to))
        } else if (name === 'InlineCode') {
          ranges.push(code.range(node.from, node.to))
        } else if (name === 'EmphasisMark' || name === 'CodeMark') {
          const parent = node.node.parent
          if (parent && !touchesCaret(parent.from, parent.to)) {
            ranges.push(hide.range(node.from, node.to))
          }
        }
      },
    })
  }
  // Marks and replacements can share a start, so let CodeMirror sort them.
  return Decoration.set(ranges, true)
}

const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/**
 * Proof the decorations ran, read from the page the user would see. Counts the styled elements,
 * and counts strong elements whose text still starts with its hidden `**`: only the one the
 * caret touches may show it.
 */
export function probeDecorations(): Record<string, number> {
  const count = (selector: string) => document.querySelectorAll(selector).length
  const strong = [...document.querySelectorAll('.tw-strong')]
  return {
    strongInDom: strong.length,
    emphasisInDom: count('.tw-em'),
    codeInDom: count('.tw-code'),
    headingLinesInDom: count('.tw-h'),
    strongShowingMarks: strong.filter((el) => (el.textContent ?? '').startsWith('**')).length,
  }
}

/** The decorations when the harness asks for them, and nothing otherwise. */
export function throwawayDecorations(params: PerfParams): Extension {
  return params.decorations === 1 ? [theme, livePreview] : []
}
