import { createState, createView } from '@/editor/create'
import { windowShown } from '@/lib/lifecycle'
import type { ScenarioContext, ScenarioOutput } from './params'
import { epochNow, framePresented, mountEditorHost } from './support'
import { throwawayDecorations } from './throwawayDecorations'

/** Epoch ms of a `performance.mark`, or 0 when it is missing. */
function markEpoch(name: string): number {
  const entry = performance.getEntriesByName(name)[0]
  return entry ? performance.timeOrigin + entry.startTime : 0
}

/**
 * Launch to editable: the app shell is up, an editor is mounted, the window is on screen and a
 * frame has been produced with the editor in it. The harness subtracts its own spawn time.
 *
 * This is the floor. The real app adds its sidebar, tabs and settings in later phases.
 */
export async function startup(ctx: ScenarioContext): Promise<ScenarioOutput> {
  const view = createView(
    mountEditorHost(),
    createState('# Untitled\n\nStart typing.\n', throwawayDecorations(ctx.params)),
  )
  view.focus()
  const editorMountedMs = epochNow()

  await windowShown
  const windowShownMs = markEpoch('window-shown')
  view.focus()
  await framePresented()
  const readyMs = epochNow()

  return {
    samples: {},
    values: {
      timeOriginMs: performance.timeOrigin,
      rustStartedMs: ctx.config.rustStartedMs,
      appMountedMs: markEpoch('app-mounted'),
      editorMountedMs,
      windowShownMs,
      readyMs,
      editorFocused: view.hasFocus ? 1 : 0,
    },
  }
}
