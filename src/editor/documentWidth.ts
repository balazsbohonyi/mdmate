import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type { Settings } from '@/lib/settings'
import { settings } from '@/lib/settings'
import { refreshDocumentFonts } from './documentFonts'

/**
 * How wide the text column of an editor tab gets, from `editor.limitContentWidth` and
 * `editor.contentMaxWidth` in settings.json. The limit reaches the editor as one custom property on
 * the page's root, which only the editor's theme reads: the Settings screen, the sidebar and the
 * chrome are not editors and never use it. With the limit on, the text column stops at the width and
 * sits in the middle of the pane; in a narrower pane it uses the whole width. A change takes effect
 * with no restart: the property is set again and each open view measures its text again.
 *
 * The limit is the width of wrapped text, so it applies while word wrap is on. The two JSON files
 * the app owns keep the whole width (`keepsFullWidth`): their template lines run
 * past a reading column, and wrapping the comments would only make them harder to read.
 */

/** The space on each side of the text, shared with the editor's theme. */
export const CONTENT_PADDING_X = '1.5rem'

/** The custom property the editor's theme reads for the widest the content box gets. */
export const WIDTH_VARIABLE = '--doc-content-max'

/**
 * The widest the content box gets, as CSS: the column plus the padding on both sides (the setting
 * counts the text, not the padding), or `none` when there is no limit.
 */
export function contentWidthValue(editor: Readonly<Settings['editor']> = settings.editor): string {
  return editor.limitContentWidth
    ? `calc(${String(editor.contentMaxWidth)}px + 2 * ${CONTENT_PADDING_X})`
    : 'none'
}

/** The class a view gets when it keeps the whole width. */
export const FULL_WIDTH_CLASS = 'cm-fullWidth'

/** The names of the app's own JSON files, which keep the whole width wherever they are. */
const FULL_WIDTH_NAMES: ReadonlySet<string> = new Set(['settings.json', 'keybindings.json'])

/** Whether a tab named `name` keeps the whole width whatever the setting says. */
export function keepsFullWidth(name: string): boolean {
  return FULL_WIDTH_NAMES.has(name.toLowerCase())
}

const views = new Set<EditorView>()

/** Tracks the views that show a state with this extension, so a rename reaches them. */
const tracker = ViewPlugin.define((view) => {
  views.add(view)
  return {
    destroy() {
      views.delete(view)
    },
  }
})

/**
 * The extension for a tab whose name can change: the view carries `cm-fullWidth` while the name is
 * one of the app's own JSON files. `refreshFullWidth` makes each view ask the name again.
 */
export function fullWidthFor(name: () => string): Extension {
  return [
    tracker,
    EditorView.editorAttributes.of(() =>
      keepsFullWidth(name()) ? { class: FULL_WIDTH_CLASS } : null,
    ),
  ]
}

/** Gives every view that follows a name one update, so a rename to or from a JSON file shows. */
export function refreshFullWidth(): void {
  for (const view of views) view.dispatch({})
}

/**
 * Sets the property on the page's root from the live settings. Without a page (the store also runs
 * in tests that have none) there is nothing to set.
 */
export function applyContentWidth(
  target: HTMLElement | undefined = typeof document === 'undefined'
    ? undefined
    : document.documentElement,
): void {
  target?.style.setProperty(WIDTH_VARIABLE, contentWidthValue())
}

/** What was last set, so a change of another setting does not make every view measure again. */
let applied = ''

/** Sets the property from the live settings and tells the open views, when it changed. */
export function updateContentWidth(): void {
  const value = contentWidthValue()
  if (value === applied) return
  applied = value
  applyContentWidth()
  refreshDocumentFonts()
}

/** Forgets what was set and takes the property off the root, for a test. */
export function resetContentWidth(
  target: HTMLElement | undefined = typeof document === 'undefined'
    ? undefined
    : document.documentElement,
): void {
  applied = ''
  target?.style.removeProperty(WIDTH_VARIABLE)
}
