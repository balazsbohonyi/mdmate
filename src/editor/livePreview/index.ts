/**
 * Live preview, inline layer: Markdown renders where you type, and its syntax shows only at the
 * caret. A `ViewPlugin` turns `scanPreview` over the visible ranges into decorations. It adds
 * styling and hides characters; it never changes the document, so the text and the bytes saved
 * stay exactly what was typed.
 *
 * Block widgets (tables, images, frontmatter) are a separate layer, because only directly
 * provided decorations can change block structure. Checkboxes stay inline: they change no height.
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
import { blockLayer } from './blocks'
import { boxTheme } from './box'
import { BulletWidget } from './bullet'
import { CheckboxWidget } from './checkbox'
import { CopyWidget } from './codeCopy'
import { IndentWidget } from './indent'
import { listSpace } from './listSpace'
import { SwatchWidget } from './swatch'
import { previewTheme } from './theme'
import { classes, scanPreview, type PreviewItem } from './scan'

const hide = Decoration.replace({})
const checkboxes = {
  open: Decoration.replace({ widget: new CheckboxWidget(false) }),
  done: Decoration.replace({ widget: new CheckboxWidget(true) }),
}
const bullet = Decoration.replace({ widget: new BulletWidget() })
const copyButton = Decoration.widget({ widget: new CopyWidget(), side: -1 })
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
    } else if (item.type === 'checkbox') {
      ranges.push((item.checked ? checkboxes.done : checkboxes.open).range(item.from, item.to))
    } else if (item.type === 'bullet') {
      ranges.push(bullet.range(item.from, item.to))
    } else if (item.type === 'swatch') {
      // A point widget before the span (side -1), so it sits outside the code and not on the caret.
      ranges.push(
        Decoration.widget({ widget: new SwatchWidget(item.color), side: -1 }).range(item.at),
      )
    } else if (item.type === 'indent') {
      // After the caret at its position (side 1), so the start of the line stays at the margin.
      ranges.push(
        Decoration.widget({ widget: new IndentWidget(item.text), side: 1 }).range(item.from),
      )
    } else if (item.type === 'copy') {
      // A point widget before the opening fence, drawn out of the flow: it is no step for the caret.
      ranges.push(copyButton.range(item.at))
    } else if (item.type === 'mark') {
      // The marker's box goes round the bullet widget too, so it is an outer decoration (below).
      if (item.class === classes.boxLead) continue
      const decoration = shared(marks, item.class, () => Decoration.mark({ class: item.class }))
      ranges.push(decoration.range(item.from, item.to))
    } else {
      // A line with attributes (a label) is not shared: labels are free text and the cache is not bounded.
      const decoration =
        item.attributes === undefined
          ? shared(lines, item.class, () => Decoration.line({ class: item.class }))
          : Decoration.line({ class: item.class, attributes: item.attributes })
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
    // A bullet is one character the caret steps over, like hidden syntax.
    if (item.type === 'hide' || item.type === 'bullet') ranges.push(hide.range(item.from, item.to))
  }
  return Decoration.set(ranges, true)
}

// Inclusive at its start, so a widget that replaces the first character is inside it too.
const boxLead = Decoration.mark({ class: classes.boxLead, inclusiveStart: true })

/**
 * What stands before a fence on a marker line, as marks that go round everything there, the bullet
 * and checkbox widgets included, so the marker is one box with a width of its own (box.ts).
 */
export function leadsFor(items: readonly PreviewItem[]): DecorationSet {
  const ranges = items.flatMap((item) =>
    item.type === 'mark' && item.class === classes.boxLead
      ? [boxLead.range(item.from, item.to)]
      : [],
  )
  return Decoration.set(ranges, true)
}

class PreviewPlugin {
  decorations: DecorationSet
  hidden: DecorationSet
  leads: DecorationSet = Decoration.none

  constructor(view: EditorView) {
    this.decorations = Decoration.none
    this.hidden = Decoration.none
    this.build(view)
  }

  build(view: EditorView): void {
    const items = scanPreview(view.state, view.visibleRanges)
    this.decorations = decorationsFor(items)
    this.hidden = hiddenFor(items)
    this.leads = leadsFor(items)
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

const outer = EditorView.outerDecorations.of(
  (view) => view.plugin(plugin)?.leads ?? Decoration.none,
)

/** Hidden syntax is one step for the caret, so a move never lands strictly inside it. */
const atomic = EditorView.atomicRanges.of((view) => view.plugin(plugin)?.hidden ?? Decoration.none)

/**
 * The inline live-preview layer, with its theme. `atomic: false` leaves the caret motion to
 * CodeMirror alone, which the walk test uses to show that atomic ranges change nothing today.
 */
export function livePreview(options: { atomic?: boolean } = {}): Extension {
  const base = [previewTheme, boxTheme, plugin, outer, listSpace]
  const inline = options.atomic === false ? base : [...base, atomic]
  return [inline, blockLayer()]
}

export { scanPreview, type PreviewItem } from './scan'
