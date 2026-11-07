/**
 * What a tab shows. A union on `kind`: Phase 2 has Markdown documents, and Phase 6 adds plain text
 * and image tabs as new members. Several tabs may show one document, in different panes.
 */
export interface MarkdownTab {
  readonly kind: 'markdown'
  readonly docId: number
}

export type TabRecord = MarkdownTab

export type TabKind = TabRecord['kind']

/** What a tab strip needs to draw one tab. */
export interface TabInfo {
  readonly id: string
  readonly kind: TabKind
  readonly title: string
  /** The tab's document has unsaved edits. */
  readonly dirty: boolean
}
