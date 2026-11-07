/**
 * Live preview, inline layer: Markdown renders where you type, and its syntax shows only at the
 * caret. A `ViewPlugin` turns `scanPreview` over the visible ranges into decorations. It adds
 * styling and hides characters; it never changes the document, so the text and the bytes saved
 * stay exactly what was typed.
 *
 * Block widgets (tables, images, frontmatter) are a separate layer in Phase 4, because only
 * directly provided decorations can change block structure.
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
import { previewTheme } from './theme'
import { scanPreview, type PreviewItem } from './scan'

const hide = Decoration.replace({})
const marks = new Map<string, Decoration>()
const lines = new Map<string, Decoration>()

/** One shared decoration per class, so a rebuild allocates only the ranges. */
function shared(cache: Map<string, Decoration>, key: string, make: () => Decoration): Decoration {
  let decoration = cache.get(key)
  if (decoration === undefined) {
    decoration = make()
    cache.set(key, decoration)
  }
  return decoration
}

/** The decoration set for `items`. Marks and replacements can share a start, so CodeMirror sorts. */
export function decorationsFor(items: readonly PreviewItem[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const item of items) {
    if (item.type === 'hide') {
      ranges.push(hide.range(item.from, item.to))
    } else if (item.type === 'mark') {
      const decoration = shared(marks, item.class, () => Decoration.mark({ class: item.class }))
      ranges.push(decoration.range(item.from, item.to))
    } else {
      const decoration = shared(lines, item.class, () => Decoration.line({ class: item.class }))
      ranges.push(decoration.range(item.from))
    }
  }
  return Decoration.set(ranges, true)
}

/**
 * Only the hidden ranges, as their own set. `atomicRanges` makes every range in a set one step for
 * the caret, so it must not get the marks over whole bold words or link text.
 */
export function hiddenFor(items: readonly PreviewItem[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const item of items) {
    if (item.type === 'hide') ranges.push(hide.range(item.from, item.to))
  }
  return Decoration.set(ranges, true)
}

class PreviewPlugin {
  decorations: DecorationSet
  hidden: DecorationSet

  constructor(view: EditorView) {
    this.decorations = Decoration.none
    this.hidden = Decoration.none
    this.build(view)
  }

  build(view: EditorView): void {
    const items = scanPreview(view.state, view.visibleRanges)
    this.decorations = decorationsFor(items)
    this.hidden = hiddenFor(items)
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    ) {
      this.build(update.view)
    }
  }
}

const plugin = ViewPlugin.fromClass(PreviewPlugin, {
  decorations: (instance) => instance.decorations,
})

/** Hidden syntax is one step for the caret, so a move never lands strictly inside it. */
const atomic = EditorView.atomicRanges.of((view) => view.plugin(plugin)?.hidden ?? Decoration.none)

/**
 * The inline live-preview layer, with its theme. `atomic: false` leaves the caret motion to
 * CodeMirror alone, which the walk test uses to show that atomic ranges change nothing today.
 */
export function livePreview(options: { atomic?: boolean } = {}): Extension {
  return options.atomic === false ? [previewTheme, plugin] : [previewTheme, plugin, atomic]
}

export { scanPreview, type PreviewItem } from './scan'
