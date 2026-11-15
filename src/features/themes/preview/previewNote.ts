import { EditorSelection } from '@codemirror/state'

/**
 * The note the Theme preview shows in its editor: a project README, written to carry one of each
 * thing the editor draws, so a color has something to land on wherever it is used. The front matter,
 * the six heading levels, bold, italic, strikethrough, a link to a file that is there and one to a
 * file that is not, inline code, fenced code in several languages, a quote, nested lists, a task
 * list, a table, a picture, and a rule. The html block holds a closing tag that closes nothing,
 * which is the one thing in a note that reads as invalid code.
 *
 * Two links are told apart by their targets: the preview answers "missing" for the file whose name
 * says so (`PREVIEW_MISSING`) and "there" for the others, with no folder open and no host call.
 */

/** The target of the link that points at a file that is not there. */
export const PREVIEW_MISSING = 'notes/missing-design.md'

/** What the find bar of the preview searches for: the preview's editor marks every match. */
export const PREVIEW_FIND = 'tide'

/** The words the selection covers, in a paragraph with nothing drawn around them. */
const SELECTED = 'keeps them on disk'

/** The find bar's current match is the `PREVIEW_FIND` in these words. */
const ACTIVE_IN = 'prints tide times'

/** The caret sits after these words. */
const CARET_AFTER = 'needs nothing'

const FENCE = '```'

export const PREVIEW_NOTE = [
  '---',
  'title: Tidewatch',
  'version: 0.4.0',
  'tags: [cli, tides]',
  '---',
  '',
  '# Tidewatch',
  '',
  'Tidewatch prints tide times for the harbor you pick. It is **fast**, *small*, and ~~needs an account~~ needs no network after the first run. See the [roadmap](notes/roadmap.md) for what comes next, and the [old design](' +
    PREVIEW_MISSING +
    ') that was removed.',
  '',
  'Tidewatch reads the tide tables once and keeps them on disk. After that it needs nothing else.',
  '',
  '![The harbor chart](chart.png)',
  '',
  '## Install',
  '',
  '### From source',
  '',
  '#### Requirements',
  '',
  '##### Toolchain',
  '',
  '###### Windows',
  '',
  'Install the Rust toolchain, then run `cargo install tidewatch`.',
  '',
  '> Tides follow the moon, not the clock. Times are local to the harbor.',
  '',
  '## Usage',
  '',
  FENCE + 'bash',
  '# Show the next three days for one harbor',
  'tidewatch --harbor "Porto" --days 3',
  FENCE,
  '',
  FENCE + 'ts',
  'interface Harbor {',
  '  name: string',
  '  depth: number',
  '}',
  '',
  '/** The next high tide: one every 12 hours and 25 minutes. */',
  'function nextHigh(harbor: Harbor, now = Date.now()): string {',
  '  const gap = 12.42 * 3600 * 1000 // in milliseconds',
  '  return `${harbor.name}: ${new Date(now + gap).toISOString()}`',
  '}',
  FENCE,
  '',
  FENCE + 'json',
  '{ "harbor": "Porto", "days": 3, "offline": true }',
  FENCE,
  '',
  FENCE + 'rust',
  'fn main() {',
  '    let tides: Vec<u32> = vec![1405, 1448];',
  '    println!("{} tides today", tides.len());',
  '}',
  FENCE,
  '',
  FENCE + 'html',
  '<p class="tide">High at 14:05</div>',
  FENCE,
  '',
  '## Roadmap',
  '',
  '- Harbors',
  '  - Porto',
  '    - Leixões',
  '  - Lisbon',
  '1. Parse the tide tables',
  '2. Cache them on disk',
  '   1. Keep one file per harbor',
  '',
  '- [x] Tide table parser',
  '- [x] Offline cache',
  '- [ ] Moon phase column',
  '- [ ] Windows installer',
  '',
  '| Harbor | Depth (m) | Next high |',
  '| ------ | --------: | --------- |',
  '| Porto | 12.4 | 14:05 |',
  '| Lisbon | 15.0 | 14:48 |',
  '',
  '---',
  '',
  '## Changelog',
  '',
  '### 0.4.0',
  '',
  '- Added the offline cache.',
  '- Fixed a wrong tide time at midnight.',
  '',
].join('\n')

/**
 * The selection the preview's editor starts with: some words selected, the find bar's current
 * match selected, and a caret. The editor has three ranges so the selection color, the current
 * match color and the caret all show; the app's own editor has one, and that is the only reason
 * for the difference.
 */
export function previewSelection(text: string = PREVIEW_NOTE): EditorSelection {
  const words = text.indexOf(SELECTED)
  const active = text.indexOf(ACTIVE_IN) + 'prints '.length
  const caret = text.indexOf(CARET_AFTER) + CARET_AFTER.length
  if (words < 0 || active < 'prints '.length || caret < CARET_AFTER.length) {
    throw new Error('the sample note lost a phrase the selection is built on')
  }
  const ranges = [
    EditorSelection.range(words, words + SELECTED.length),
    EditorSelection.range(active, active + PREVIEW_FIND.length),
    EditorSelection.cursor(caret),
  ].sort((x, y) => x.from - y.from)
  return EditorSelection.create(
    ranges,
    ranges.findIndex((range) => range.from === active),
  )
}
