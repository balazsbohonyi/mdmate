/**
 * What a tab shows. A union on `kind`: a document tab (Markdown in the live editor, or any other
 * text file as plain source) and an image tab. Several tabs may show one document, in different
 * panes. An image is not a document: Rust holds nothing open for it, so its tab carries the path.
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

export type TabRecord = DocumentTab | ImageTab

export type TabKind = TabRecord['kind']

/** The document a tab shows, or undefined for a tab that shows no document. */
export function docIdOf(record: TabRecord | undefined): number | undefined {
  return record === undefined || record.kind === 'image' ? undefined : record.docId
}

/** What a tab strip needs to draw one tab. */
export interface TabInfo {
  readonly id: string
  readonly kind: TabKind
  readonly title: string
  /** The tab's document has unsaved edits. */
  readonly dirty: boolean
}
