import { RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/**
 * Colors for the comments of a JSON file. `settings.json` and `keybindings.json` are JSON with
 * comments, but the JSON grammar has no comments: it reads `// "theme": "dark",` as a broken string
 * and colors the pieces, so a commented line looks like live code. This finds the `//` and
 * `/* *\/` comments itself (never one inside a string, so `"http://x"` is left alone) and colors
 * them with the same `--syntax-comment` token as any other language's comments.
 *
 * A file over `MAX_LENGTH` characters is left as the grammar colors it: the scan reads the whole
 * text on each edit, and a file that big is not one of the settings files.
 */

const MAX_LENGTH = 1_000_000

const TOKEN = /"(?:[^"\\\n]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g

/** The `[from, to)` ranges of the comments in the text. */
export function jsonCommentRanges(text: string): [number, number][] {
  const found: [number, number][] = []
  for (const match of text.matchAll(TOKEN)) {
    if (match[0].startsWith('//') || match[0].startsWith('/*')) {
      found.push([match.index, match.index + match[0].length])
    }
  }
  return found
}

const comment = Decoration.mark({ class: 'cm-jsonc-comment' })

function comments(view: EditorView): DecorationSet {
  const { doc } = view.state
  if (doc.length > MAX_LENGTH) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  for (const [from, to] of jsonCommentRanges(doc.toString())) builder.add(from, to, comment)
  return builder.finish()
}

export const jsonComments: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = comments(view)
      }
      update(update: ViewUpdate): void {
        if (update.docChanged) this.decorations = comments(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  // The grammar's own token spans sit inside a comment, so they are made to take its color.
  EditorView.baseTheme({
    '.cm-jsonc-comment, .cm-jsonc-comment *': {
      color: 'var(--syntax-comment) !important',
      fontStyle: 'italic',
    },
  }),
]
