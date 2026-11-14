import { commandState, listCommands, isCommandEnabled, shortcutLabel } from '@/workbench/commands'
import { settings } from '@/lib/settings'
import { THEME_CHOICES } from '@/lib/themes'
import { detectPlatform } from '@/workbench/keybinding'
import { rankByFuzzy } from '@/lib/fuzzy'
import type { QuickOpenItem } from '@/platform/quickOpen'
import { PALETTE_COMMAND_IDS } from './state'

/** A line in a picker. `labelHits` and `detailHits` are the letters to mark, as UTF-16 offsets. */
export interface PickRow {
  readonly key: string
  readonly label: string
  readonly labelHits: readonly number[]
  readonly detail: string
  readonly detailHits: readonly number[]
  /** Shown greyed and does nothing when chosen. */
  readonly disabled: boolean
  /** For a toggle command: whether it is on, shown as On or Off. Null for every other row. */
  readonly state: boolean | null
}

/** A file result as a line: its name first, then the folder it is in. */
export function fileRow(item: QuickOpenItem): PickRow {
  const label = item.rel.slice(item.nameStart)
  const folder = item.rel.slice(0, item.nameStart)
  return {
    key: item.path,
    label,
    labelHits: item.matches.filter((at) => at >= item.nameStart).map((at) => at - item.nameStart),
    detail: folder.replace(/\/$/, ''),
    detailHits: item.matches.filter((at) => at < item.nameStart),
    disabled: false,
    state: null,
  }
}

/** The commands whose title holds what was typed, best first; all of them, by title, for nothing. */
export function commandRows(query: string): PickRow[] {
  const platform = detectPlatform()
  const commands = listCommands().filter((command) => !PALETTE_COMMAND_IDS.has(command.id))
  const row = (id: string, title: string, hits: readonly number[]): PickRow => ({
    key: id,
    label: title,
    labelHits: hits,
    detail: shortcutLabel(id, platform) ?? '',
    detailHits: [],
    disabled: !isCommandEnabled(id),
    state: commandState(id) ?? null,
  })
  if (query.trim() === '') {
    return [...commands]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((command) => row(command.id, command.title, []))
  }
  return rankByFuzzy(commands, query, (command) => command.title).map(({ item, hit }) =>
    row(item.id, item.title, hit.matches),
  )
}

/** The themes whose name holds what was typed; the one in use says so. */
export function themeRows(query: string): PickRow[] {
  const row = (value: string, label: string, hits: readonly number[]): PickRow => ({
    key: value,
    label,
    labelHits: hits,
    detail: settings.theme === value ? 'In use' : '',
    detailHits: [],
    disabled: false,
    state: null,
  })
  if (query.trim() === '') return THEME_CHOICES.map((theme) => row(theme.value, theme.label, []))
  return rankByFuzzy([...THEME_CHOICES], query, (theme) => theme.label).map(({ item, hit }) =>
    row(item.value, item.label, hit.matches),
  )
}

/** A run of text that is marked or not. */
export interface Segment {
  readonly text: string
  readonly hit: boolean
}

/** Splits text at the marked letters, whose positions are UTF-16 offsets. */
export function segments(text: string, hits: readonly number[]): Segment[] {
  if (hits.length === 0) return text === '' ? [] : [{ text, hit: false }]
  const marked = new Set(hits)
  const out: Segment[] = []
  let at = 0
  for (const letter of text) {
    const hit = marked.has(at)
    const last = out.at(-1)
    if (last?.hit === hit) out[out.length - 1] = { text: last.text + letter, hit }
    else out.push({ text: letter, hit })
    at += letter.length
  }
  return out
}
