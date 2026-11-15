import type { SettingsCategory } from '@/lib/settingsCategories'

/**
 * What a tab shows. A union on `kind`: a document tab (Markdown in the live editor, or any other
 * text file as plain source), an image tab, the Settings tab and the Theme preview tab. Several
 * tabs may show one document, in different panes. An image is not a document: Rust holds nothing
 * open for it, so its tab carries the path. The Settings tab and the Theme preview are not files
 * either, and there is only ever one of each.
 */
export interface DocumentTab {
  readonly kind: 'markdown' | 'text'
  readonly docId: number
}

export interface ImageTab {
  readonly kind: 'image'
  /** The path as people read it; a rename or move in the tree changes it. */
  readonly path: string
  /** The size on disk in bytes, as Rust reported it when the tab opened. */
  readonly size: number
}

/** The Settings screen. At most one exists; opening it again shows that one (ISC-343). */
export interface SettingsTab {
  readonly kind: 'settings'
  /** The group of settings the screen is showing; it comes back with the session (ISC-344). */
  readonly category: SettingsCategory
}

/**
 * A read-only sample of the app drawn in the colors of the theme in force, beside the Settings
 * screen, so a color changed there shows at once. At most one exists, and it is never saved with a
 * session: it is a view of the settings, so it has nothing of its own to bring back.
 */
export interface ThemePreviewTab {
  readonly kind: 'themePreview'
}

export type TabRecord = DocumentTab | ImageTab | SettingsTab | ThemePreviewTab

/** A tab that shows no file and no document: the Settings screen and the Theme preview. */
export type PanelTab = SettingsTab | ThemePreviewTab

/** True for a tab that is a screen of the app and not a file: it has no document and no caret. */
export function isPanelTab(record: TabRecord | undefined): record is PanelTab {
  return record?.kind === 'settings' || record?.kind === 'themePreview'
}

export type TabKind = TabRecord['kind']

/** The document a tab shows, or undefined for a tab that shows no document. */
export function docIdOf(record: TabRecord | undefined): number | undefined {
  return record === undefined || record.kind === 'image' || isPanelTab(record)
    ? undefined
    : record.docId
}

/** What a tab strip needs to draw one tab. */
export interface TabInfo {
  readonly id: string
  readonly kind: TabKind
  readonly title: string
  /** The tab's document has unsaved edits. */
  readonly dirty: boolean
}
