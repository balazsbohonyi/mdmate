import { EditorView, ViewPlugin } from '@codemirror/view'
import { settings } from '@/lib/settings'

/**
 * Whether long lines wrap, from `editor.wordWrap` in settings.json. The class that wraps is the one
 * `EditorView.lineWrapping` adds; here it comes from a function the view asks on every update, so
 * a change of the setting only has to give each view one update to take effect, with no restart
 * and no reopening of tabs. A state that is not shown has nothing to update: it asks when it is.
 */
const views = new Set<EditorView>()

/** Tracks the views that show a state with this extension, so a change of the setting reaches them. */
const tracker = ViewPlugin.define((view) => {
  views.add(view)
  return {
    destroy() {
      views.delete(view)
    },
  }
})

export const wordWrap = [
  EditorView.contentAttributes.of(() =>
    settings.editor.wordWrap ? { class: 'cm-lineWrapping' } : null,
  ),
  tracker,
]

/** Gives every view that is showing one update, so it asks the setting again. */
export function refreshWordWrap(): void {
  for (const view of views) view.dispatch({})
}
