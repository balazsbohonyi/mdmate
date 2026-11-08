import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** A node of the syntax tree, typed without a direct `@lezer/common` dependency (as in scan.ts). */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolve']>

/** A link in the text: where it is, and its target exactly as written (not yet trusted). */
export interface LinkHit {
  readonly from: number
  readonly to: number
  readonly href: string
}

/** Nodes that carry their own address, so a URL inside them is not a bare URL. */
const ADDRESSED = new Set(['Link', 'Image', 'Autolink', 'LinkReference'])

/** Collapses whitespace and case the way CommonMark matches a reference label. */
function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The target of `[label]: target` anywhere in the document. Read from the text, not the tree,
 * since the parser may not have reached a definition at the end of a long file.
 */
function referenceTarget(state: EditorState, label: string): string | null {
  const wanted = normalizeLabel(label)
  if (wanted === '') return null
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text
    const match = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*(<[^>\n]*>|\S+)/.exec(text)
    if (match?.[1] !== undefined && match[2] !== undefined && normalizeLabel(match[1]) === wanted)
      return match[2]
  }
  return null
}

function childText(state: EditorState, node: SyntaxNode, name: string): string | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return state.sliceDoc(child.from, child.to)
  }
  return null
}

/** The target a link node points at, or null when it has none (an undefined reference). */
function targetOf(state: EditorState, node: SyntaxNode): string | null {
  switch (node.name) {
    case 'Link': {
      const url = childText(state, node, 'URL')
      if (url !== null) return url
      // `[text][label]`, or `[text]` where the text is the label.
      const label = childText(state, node, 'LinkLabel')
      const text = state.sliceDoc(node.from, node.to)
      const close = text.indexOf(']')
      const name =
        label !== null && label.length > 2
          ? label.slice(1, -1)
          : text.slice(1, close === -1 ? undefined : close)
      return referenceTarget(state, name)
    }
    case 'Autolink': {
      const url = childText(state, node, 'URL')
      if (url === null) return null
      // `<a@b.c>` is a mail address with no scheme.
      return !/^[a-z][a-z0-9+.-]*:/i.test(url) && url.includes('@') ? `mailto:${url}` : url
    }
    case 'URL': {
      // A bare URL (GFM). `www.` addresses mean http.
      const url = state.sliceDoc(node.from, node.to)
      if (/^www\./i.test(url)) return `http://${url}`
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && url.includes('@')) return `mailto:${url}`
      return url
    }
    default:
      return null
  }
}

/** The link at `pos`, if any: an inline or reference link, an autolink, or a bare URL. */
export function linkAt(state: EditorState, pos: number): LinkHit | null {
  const tree = syntaxTree(state)
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      const isLink =
        node.name === 'Link' ||
        node.name === 'Autolink' ||
        (node.name === 'URL' && (node.parent === null || !ADDRESSED.has(node.parent.name)))
      if (!isLink) continue
      const href = targetOf(state, node)
      if (href === null) return null
      return { from: node.from, to: node.to, href }
    }
  }
  return null
}

/** True for the gesture that follows a link: Ctrl+click, or Cmd+click on macOS. Never a plain click. */
export function isFollowGesture(event: MouseEvent): boolean {
  return event.button === 0 && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
}

/**
 * Follows a link on Ctrl+click: calls `follow` with the target as written and keeps the click
 * from moving the caret. A plain click is left to CodeMirror, which only places the caret. What a
 * target may do is decided by the link guard in Rust, never here.
 */
export function linkNavigation(follow: (hit: LinkHit) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!isFollowGesture(event)) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      const hit = linkAt(view.state, pos)
      if (hit === null) return false
      event.preventDefault()
      follow(hit)
      return true
    },
  })
}
