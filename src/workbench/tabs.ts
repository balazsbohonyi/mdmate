import type { SettingsCategory } from '@/lib/settingsCategories'

/**
 * What a tab shows. A union on `kind`: a document tab (Markdown in the live editor, or any other
 * text file as plain source), an image tab and the Settings tab. Several tabs may show one
 * document, in different panes. An image is not a document: Rust holds nothing open for it, so its
 * tab carries the path. The Settings tab is not a file either, and there is only ever one.
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

export type TabRecord = DocumentTab | ImageTab | SettingsTab

export type TabKind = TabRecord['kind']

/** The document a tab shows, or undefined for a tab that shows no document. */
export function docIdOf(record: TabRecord | undefined): number | undefined {
  return record === undefined || record.kind === 'image' || record.kind === 'settings'
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
