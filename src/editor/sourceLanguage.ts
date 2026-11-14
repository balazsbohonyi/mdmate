import { syntaxHighlighting } from '@codemirror/language'
import { Compartment, type Extension } from '@codemirror/state'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import { settings } from '@/lib/settings'
import { languageForFile } from './codeLanguages'
import { tokenHighlight } from './highlight'

/**
 * Colors for a file that opens as plain source, by its extension. A file that is not Markdown shows
 * as text with no parser (`createFollowerState`); when its extension is in `editor.highlightExtensions`
 * (settings.json) it also gets the language of its name, loaded the first time one is seen
 * (`codeLanguages.ts`) and colored by the same `--syntax-*` tokens as a fenced block. The first
 * paint is plain and the colors follow when the parser arrives. A change of the setting reaches
 * every open view through `refreshSourceLanguages`, with no restart and no reopening of tabs.
 */

/** The extension of `name` in lower case, without the dot, or '' for none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** True when a plain-source file of this name gets colors, by the setting in force. */
export function hasSourceLanguage(name: string): boolean {
  const extension = extensionOf(name)
  return extension !== '' && settings.editor.highlightExtensions.includes(extension)
}

/** What each view asks again when the setting changes. */
const syncs = new Set<() => void>()

/**
 * The extension that colors a plain-source file named `name`; it does nothing for a name the setting
 * leaves out. Pass a function for a file that can be renamed: the name is read again on every
 * `refreshSourceLanguages`, so a rename to another extension changes the colors with no reopening.
 */
export function sourceLanguage(name: string | (() => string)): Extension {
  const slot = new Compartment()
  const loader = ViewPlugin.define((view: EditorView) => {
    let gone = false
    // The name whose language the view shows now, or null for plain text.
    let shown: string | null = null
    const sync = (): void => {
      const current = typeof name === 'string' ? name : name()
      const key = hasSourceLanguage(current) ? current.toLowerCase() : null
      if (key === shown) return
      shown = key
      if (key === null) {
        view.dispatch({ effects: slot.reconfigure([]) })
        return
      }
      void languageForFile(current).then((support) => {
        // The setting or the name may have changed, or the view gone, while the parser was loading.
        if (gone || shown !== key) return
        view.dispatch({
          effects: slot.reconfigure(
            support === null ? [] : [support, syntaxHighlighting(tokenHighlight)],
          ),
        })
      })
    }
    syncs.add(sync)
    sync()
    return {
      destroy() {
        gone = true
        syncs.delete(sync)
      },
    }
  })
  return [slot.of([]), loader]
}

/** Gives every view that shows a colored-by-extension file the setting again. */
export function refreshSourceLanguages(): void {
  for (const sync of [...syncs]) sync()
}
