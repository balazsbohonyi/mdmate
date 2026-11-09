import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type TransactionSpec,
} from '@codemirror/state'

/**
 * Formatting commands as pure functions from a state to the change they make, or null when they
 * do nothing. Each toggles: a second run on the same text takes the formatting off again. They
 * read the syntax tree to know what is already formatted, so `**` inside code is not bold.
 */

/** A node of the syntax tree, typed without a direct `@lezer/common` dependency (as in scan.ts). */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolve']>

export interface InlineFormat {
  /** The marker written on both sides when the format is added. */
  readonly marker: string
  /** The node the parser makes for this format. */
  readonly node: 'StrongEmphasis' | 'Emphasis' | 'Strikethrough' | 'InlineCode'
  /** The node of its markers. */
  readonly mark: 'EmphasisMark' | 'StrikethroughMark' | 'CodeMark'
}

export const BOLD: InlineFormat = { marker: '**', node: 'StrongEmphasis', mark: 'EmphasisMark' }
export const ITALIC: InlineFormat = { marker: '*', node: 'Emphasis', mark: 'EmphasisMark' }
export const STRIKETHROUGH: InlineFormat = {
  marker: '~~',
  node: 'Strikethrough',
  mark: 'StrikethroughMark',
}
export const INLINE_CODE: InlineFormat = { marker: '`', node: 'InlineCode', mark: 'CodeMark' }

/** The tree, parsed at least as far as `to` when that is quick. */
function treeTo(state: EditorState, to: number) {
  return ensureSyntaxTree(state, to, 50) ?? syntaxTree(state)
}

/**
 * The innermost node of this format around `from` to `to`. A selection counts with its edges on
 * the node's edges (`**word**` selected whole); a caret only strictly inside, so a caret just after
 * a bold word starts a new pair instead of taking the bold off what was just typed.
 */
function enclosing(
  state: EditorState,
  format: InlineFormat,
  from: number,
  to: number,
): SyntaxNode | null {
  const caret = from === to
  for (
    let node: SyntaxNode | null = treeTo(state, to).resolveInner(from, 1);
    node;
    node = node.parent
  ) {
    const around = caret ? node.from < from && node.to > to : node.from <= from && node.to >= to
    if (node.name === format.node && around) return node
    if (node.name === 'Paragraph' || node.name === 'Document') break
  }
  return null
}

/** The changes that take a node's own markers away. */
function unwrap(node: SyntaxNode, format: InlineFormat): ChangeSpec[] {
  const marks: { from: number; to: number }[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === format.mark) marks.push({ from: child.from, to: child.to })
  }
  const first = marks[0]
  const last = marks.at(-1)
  if (first === undefined || last === undefined || first === last) return []
  return [
    { from: first.from, to: first.to },
    { from: last.from, to: last.to },
  ]
}

/**
 * Toggles an inline format on the selection. With text selected: off when the selection is that
 * format's text or sits inside it, on otherwise, and the same text stays selected. With only a
 * caret: off when the caret is inside the format, otherwise an empty pair with the caret between.
 */
export function toggleInline(state: EditorState, format: InlineFormat): TransactionSpec | null {
  if (state.readOnly) return null
  const m = format.marker
  const spec = state.changeByRange((range) => {
    const node = enclosing(state, format, range.from, range.to)
    if (node !== null) {
      const changes = unwrap(node, format)
      if (changes.length > 0) {
        const set = state.changes(changes)
        return {
          changes: set,
          range: EditorSelection.range(set.mapPos(range.anchor, 1), set.mapPos(range.head, 1)),
        }
      }
    }
    if (range.empty) {
      return {
        changes: { from: range.from, insert: m + m },
        range: EditorSelection.cursor(range.from + m.length),
      }
    }
    return {
      changes: [
        { from: range.from, insert: m },
        { from: range.to, insert: m },
      ],
      range: EditorSelection.range(range.anchor + m.length, range.head + m.length),
    }
  })
  return { ...spec, scrollIntoView: true, userEvent: 'input.format' }
}

/** True for text that looks like a web address, so pasting it as a link target makes sense. */
export function looksLikeUrl(text: string): boolean {
  return /^(https?:\/\/|mailto:)[^\s<>]+$/i.test(text.trim())
}

/**
 * Inserts a link. Selected text becomes the link text, with the caret in the empty target;
 * a selected web address becomes the target, with the caret in the empty text; with nothing
 * selected, an empty link with the caret in its text.
 */
export function insertLink(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null
  const spec = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    if (range.empty) {
      return {
        changes: { from: range.from, insert: '[]()' },
        range: EditorSelection.cursor(range.from + 1),
      }
    }
    if (looksLikeUrl(text)) {
      return {
        changes: { from: range.from, to: range.to, insert: `[](${text.trim()})` },
        range: EditorSelection.cursor(range.from + 1),
      }
    }
    const insert = `[${text}]()`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    }
  })
  return { ...spec, scrollIntoView: true, userEvent: 'input.format' }
}

const ATX = /^( {0,3})(#{1,6})(?:[ \t]+|$)/

/** True when the line is inside a fenced or indented code block, where `#` is code. */
function inCode(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = treeTo(state, pos).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true
  }
  return false
}

/**
 * Raises (toward H1) or lowers (toward a paragraph) the heading of every line the selection
 * touches. Raising a paragraph makes it H6, then H5 up to H1, where it stops; lowering goes from H1
 * to H6 and then back to a paragraph. Lines in code blocks are left alone.
 */
export function shiftHeading(
  state: EditorState,
  direction: 'raise' | 'lower',
): TransactionSpec | null {
  if (state.readOnly) return null
  const changes: ChangeSpec[] = []
  const seen = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      if (inCode(state, line.from)) continue
      const match = ATX.exec(line.text)
      const indent = match?.[1] ?? ''
      const level = match?.[2]?.length ?? 0
      const prefixEnd = line.from + (match?.[0].length ?? 0)
      if (level === 0) {
        if (direction === 'raise' && line.text.trim() !== '')
          changes.push({ from: line.from, insert: '###### ' })
        continue
      }
      const next = direction === 'raise' ? Math.max(1, level - 1) : level + 1
      if (next === level) continue
      const insert = next > 6 ? '' : `${indent}${'#'.repeat(next)} `
      changes.push({ from: line.from, to: prefixEnd, insert })
    }
  }
  if (changes.length === 0) return null
  return { changes, scrollIntoView: true, userEvent: 'input.format' }
}
