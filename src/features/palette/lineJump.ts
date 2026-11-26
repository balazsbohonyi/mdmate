import { followerOfTab } from '@/documents/store'
import { jumpSpec, parseLineTarget, positionOf } from '@/editor/goToLine'
import { revealMarkEffect } from '@/editor/revealMark'
import { findPane } from '@/workbench/splitTree'
import { workbenchLayout } from '@/workbench/store'

/** One opening of the Go to line box: it shows each target as typed, and can take it all back. */
export interface LineJump {
  /** How many lines the file has. */
  readonly lines: number
  /** Jumps to what is typed. False, with nothing moved, when that is no line number. */
  show(text: string): boolean
  /** Puts the caret and the scroll position back where they were when the box opened. */
  cancel(): void
}

/** A jump in the active tab, or null when that tab holds no text. */
export function startLineJump(): LineJump | null {
  const layout = workbenchLayout.value
  const tab = findPane(layout, layout.activePane)?.activeTab ?? null
  const follower = tab === null ? undefined : followerOfTab(tab)
  if (follower === undefined) return null
  const selection = follower.state.selection
  const scroll = follower.view?.scrollSnapshot()
  let moved = false
  return {
    lines: follower.state.doc.lines,
    show(text) {
      const target = parseLineTarget(text)
      if (target === null) return false
      moved = true
      follower.dispatch(jumpSpec(follower.state, target))
      // The caret does not show while the box has focus, so the line is marked until it moves.
      const line = follower.state.doc.lineAt(positionOf(follower.state.doc, target))
      follower.dispatch({ effects: revealMarkEffect.of({ from: line.from, to: line.to }) })
      return true
    },
    cancel() {
      if (!moved) return
      // The file may have changed on disk meanwhile and be shorter now.
      const end = follower.state.doc.length
      follower.dispatch({
        selection: {
          anchor: Math.min(selection.main.anchor, end),
          head: Math.min(selection.main.head, end),
        },
        ...(scroll === undefined ? {} : { effects: scroll }),
      })
    },
  }
}
