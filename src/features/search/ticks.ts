import { documentOfTab, followerOfTab } from '@/documents/store'
import { searchHitsOf, setSearchHits, type SearchHitRange } from '@/editor/matchTicks'
import { hitsOfFile } from './store'

/**
 * Puts the folder search's hits in a tab's file on its editor, marked in the text and as ticks along the scrollbar, or
 * takes them off when the search has none there (or is gone). A hit knows its line and column
 * from when the search read the file, and a document with unsaved edits was searched from its
 * unsaved text, so they point at the same place. Called when a tab is shown and whenever the list
 * changes; it dispatches only when the positions are different from what the editor holds.
 */
export function syncSearchTicks(tabId: string): void {
  const follower = followerOfTab(tabId)
  const doc = documentOfTab(tabId)
  if (follower === undefined || doc === undefined || doc.untitled) return
  const text = follower.state.doc
  const places = hitsOfFile(doc.path).map((hit): SearchHitRange => {
    const line = text.line(Math.min(Math.max(hit.line, 1), text.lines))
    const from = line.from + Math.min(hit.column, line.length)
    return { from, to: Math.min(from + hit.length, line.to) }
  })
  const held = searchHitsOf(follower.state)
  if (
    places.length === held.length &&
    places.every((p, i) => p.from === held[i]?.from && p.to === held[i]?.to)
  )
    return
  follower.dispatch({ effects: setSearchHits.of(places) })
}
