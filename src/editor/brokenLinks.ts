import { RangeSetBuilder, StateEffect, type Extension, Facet } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { inlineLinksIn } from './links'

/**
 * Draws links whose target file is missing in a broken style. The check runs in Rust (the link
 * guard decides what a target is) and in the background: the plugin collects the inline links on
 * screen, asks about the ones it has no recent answer for, and redraws when the answer arrives.
 * Typing never waits for it.
 */

/** How long an answer counts as fresh. A file can appear or vanish, so an old answer is asked again. */
export const FRESH_MS = 5000
/** How long the plugin waits after the last change before it asks. */
export const CHECK_DELAY_MS = 250
/** The most targets one request carries; Rust refuses more. */
const BATCH = 500

/** The answers about one document's links, shared by all its tabs. */
export class LinkStatus {
  readonly #check: (hrefs: readonly string[]) => Promise<readonly boolean[]>
  readonly #known = new Map<string, { missing: boolean; at: number }>()
  readonly #now: () => number

  constructor(
    check: (hrefs: readonly string[]) => Promise<readonly boolean[]>,
    now: () => number = Date.now,
  ) {
    this.#check = check
    this.#now = now
  }

  /** True when the target is known to be missing; false when it is there or not known yet. */
  isMissing(href: string): boolean {
    return this.#known.get(href)?.missing === true
  }

  /** Targets with no answer, or an answer older than `FRESH_MS`. */
  stale(hrefs: Iterable<string>): string[] {
    const now = this.#now()
    const out = new Set<string>()
    for (const href of hrefs) {
      const known = this.#known.get(href)
      if (known === undefined || now - known.at >= FRESH_MS) out.add(href)
    }
    return [...out]
  }

  /** Asks about `hrefs` and remembers the answers. True when any answer changed. */
  async refresh(hrefs: readonly string[]): Promise<boolean> {
    let changed = false
    for (let start = 0; start < hrefs.length; start += BATCH) {
      const batch = hrefs.slice(start, start + BATCH)
      const answers = await this.#check(batch)
      const at = this.#now()
      batch.forEach((href, i) => {
        const missing = answers[i] === true
        if (this.#known.get(href)?.missing !== missing) changed = true
        this.#known.set(href, { missing, at })
      })
    }
    return changed
  }
}

/** The status of the document a view shows. Without one, nothing is checked or drawn. */
export const linkStatus = Facet.define<LinkStatus, LinkStatus | null>({
  combine: (values) => values[0] ?? null,
})

/** True for a target that names a file relative to the document: no scheme, no `#` alone. */
export function isLocalTarget(href: string): boolean {
  const target = href.trim().replace(/^<(.*)>$/, '$1')
  if (target === '' || target.startsWith('#')) return false
  return !/^[a-z][a-z0-9+.-]*:/i.test(target)
}

const brokenMark = Decoration.mark({
  class: 'cm-md-link-broken',
  attributes: { 'data-hint': 'Missing file' },
})
const refreshed = StateEffect.define<null>()

function visibleLinks(view: EditorView): { from: number; to: number; href: string }[] {
  const out = []
  for (const range of view.visibleRanges) {
    for (const hit of inlineLinksIn(view.state, range.from, range.to)) {
      if (isLocalTarget(hit.href)) out.push(hit)
    }
  }
  return out
}

class BrokenLinks {
  decorations: DecorationSet = Decoration.none
  #timer: ReturnType<typeof setTimeout> | undefined
  #destroyed = false
  readonly #view: EditorView

  constructor(view: EditorView) {
    this.#view = view
    this.#redraw()
    this.#schedule()
  }

  update(update: ViewUpdate): void {
    const answered = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshed)))
    if (update.docChanged || update.viewportChanged || answered) this.#redraw()
    if (update.docChanged || update.viewportChanged || update.focusChanged) this.#schedule()
  }

  destroy(): void {
    this.#destroyed = true
    clearTimeout(this.#timer)
  }

  #redraw(): void {
    const status = this.#view.state.facet(linkStatus)
    if (status === null) {
      this.decorations = Decoration.none
      return
    }
    const builder = new RangeSetBuilder<Decoration>()
    for (const link of visibleLinks(this.#view)) {
      if (status.isMissing(link.href)) builder.add(link.from, link.to, brokenMark)
    }
    this.decorations = builder.finish()
  }

  /** Asks after `delay`, replacing any check already waiting. */
  #schedule(delay = CHECK_DELAY_MS): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#ask().catch((error: unknown) => {
        console.error('Could not check links', error)
      })
    }, delay)
  }

  async #ask(): Promise<void> {
    const status = this.#view.state.facet(linkStatus)
    if (status === null || this.#destroyed) return
    const local = visibleLinks(this.#view)
    const stale = status.stale(local.map((link) => link.href))
    if (stale.length > 0) {
      const changed = await status.refresh(stale)
      if (this.#destroyed) return
      if (changed) this.#view.dispatch({ effects: refreshed.of(null) })
    }
    // A file can appear or vanish while nobody types or scrolls, so the links on screen are asked
    // about again once their answers go stale. A view with no local links on screen stays quiet.
    if (local.length > 0) this.#schedule(FRESH_MS)
  }
}

const brokenTheme = EditorView.baseTheme({
  '.cm-md-link-broken, .cm-md-link-broken *': {
    // The link's own color sits on spans inside the mark (live preview, the highlighter), so the
    // broken color has to win over theirs.
    color: 'var(--destructive) !important',
    textDecoration: 'underline wavy var(--destructive)',
    textDecorationSkipInk: 'none',
  },
})

/** Broken-link drawing for a view. Its document supplies the status through `linkStatus`. */
export function brokenLinks(): Extension {
  return [
    ViewPlugin.fromClass(BrokenLinks, { decorations: (plugin) => plugin.decorations }),
    brokenTheme,
  ]
}
