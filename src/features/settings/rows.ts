import type { FontKind } from '@/editor/documentFonts'
import { BUILT_IN_CHOICES } from '@/lib/themes'
import type { SettingKey } from '@/lib/settingsFile'
import type { SettingsCategory } from '@/lib/settingsCategories'

/**
 * What the screen shows for each setting: where it sits, its words, and which control edits it.
 * The values, defaults and the checking are `SETTING_DEFS`'s; this table holds only the wording and
 * the grouping, so a key cannot have a row with a rule of its own.
 */

/** The control that edits a row's value. */
export type RowControl =
  | { readonly kind: 'switch' }
  | { readonly kind: 'number' }
  /** A text field. With `browse`, a Browse button beside it picks a program from a file dialog. */
  | { readonly kind: 'text'; readonly placeholder: string; readonly browse?: true }
  /** A font family, with a sample line in the family typed. */
  | { readonly kind: 'font'; readonly family: FontKind }
  /** Six numbers, one for each heading level. */
  | { readonly kind: 'scale' }
  /**
   * A number that shares its row with a second one: this key's field, then `second`'s, side by
   * side. `second` has a spec of its own (its words and place in the template) that says
   * `drawnIn`. `labels` name the two fields for a screen reader.
   */
  | {
      readonly kind: 'pair'
      readonly second: SettingKey
      readonly labels: readonly [string, string]
    }
  | { readonly kind: 'choice'; readonly options: readonly { value: string; label: string }[] }
  | { readonly kind: 'folders' }
  /** File extensions as chips, added by picking a language from a searchable list. */
  | { readonly kind: 'extensions' }

export interface SettingRowSpec {
  readonly key: SettingKey
  readonly category: SettingsCategory
  readonly label: string
  /** One line: what it does and, where it matters, what the value means. */
  readonly description: string
  readonly control: RowControl
  /**
   * The sub-group heading the row sits under in its category. Rows of one group are next to each
   * other; a search lists rows from every category flat and shows no headings.
   */
  readonly group?: string
  /**
   * The row is drawn by the color editor, not in the list, and only while a theme of the user's is
   * being edited. It still has its key, default and place in the `settings.json` template.
   */
  readonly inEditor?: boolean
  /**
   * The key of the row this one is drawn inside (a line height beside its size). It has no row of
   * its own on the screen, and a search finds the row that holds it. It keeps its own key, default
   * and note in the `settings.json` template.
   */
  readonly drawnIn?: SettingKey
}

/** The environment variable that sets what a rename does about links for one run. */
export const LINKS_ENV_VAR = 'MDMATE_LINKS_ON_RENAME'

export const SETTING_ROWS: readonly SettingRowSpec[] = [
  {
    key: 'theme',
    category: 'appearance',
    label: 'Theme',
    group: 'Theme',
    description: 'The colours of the whole window. System follows the operating system.',
    control: { kind: 'choice', options: BUILT_IN_CHOICES },
  },
  {
    key: 'fonts.heading',
    category: 'appearance',
    group: 'Fonts',
    label: 'Heading font',
    description: 'The font of headings. Empty uses the body font.',
    control: { kind: 'font', family: 'heading' },
  },
  {
    key: 'fonts.body',
    category: 'appearance',
    group: 'Fonts',
    label: 'Body font',
    description: 'The font of the document text. Empty uses the built-in font.',
    control: { kind: 'font', family: 'body' },
  },
  {
    key: 'fonts.code',
    category: 'appearance',
    group: 'Fonts',
    label: 'Code font',
    description: 'The font of code, inline and in blocks. Empty uses the built-in code font.',
    control: { kind: 'font', family: 'code' },
  },
  {
    key: 'fonts.size',
    category: 'appearance',
    group: 'Fonts',
    label: 'Text size and line height',
    description:
      'The size of the document text, in pixels, then its line height as a multiple of the size.',
    control: {
      kind: 'pair',
      second: 'fonts.lineHeight',
      labels: ['Text size', 'Text line height'],
    },
  },
  {
    key: 'fonts.lineHeight',
    category: 'appearance',
    group: 'Fonts',
    drawnIn: 'fonts.size',
    label: 'Text line height',
    description:
      'The line height of the text, headings included, as a multiple of the size. From 1 to 3 in steps of 0.05.',
    control: { kind: 'number' },
  },
  {
    key: 'fonts.codeSize',
    category: 'appearance',
    group: 'Fonts',
    label: 'Code size and line height',
    description:
      'The size of code blocks, in pixels, then their line height as a multiple of the size. Inline code follows the text.',
    control: {
      kind: 'pair',
      second: 'fonts.codeLineHeight',
      labels: ['Code size', 'Code line height'],
    },
  },
  {
    key: 'fonts.codeLineHeight',
    category: 'appearance',
    group: 'Fonts',
    drawnIn: 'fonts.codeSize',
    label: 'Code line height',
    description:
      'The line height of code blocks, as a multiple of the size. From 1 to 3 in steps of 0.05.',
    control: { kind: 'number' },
  },
  {
    key: 'fonts.headingScale',
    category: 'appearance',
    group: 'Fonts',
    label: 'Heading sizes',
    description: 'How big each heading level is, as a multiple of the text size, H1 to H6.',
    control: { kind: 'scale' },
  },
  {
    key: 'view.zoom',
    category: 'appearance',
    label: 'Zoom',
    group: 'Window',
    description:
      'How big the whole window is, in percent, from 50 to 300. Ctrl+plus, Ctrl+minus and Ctrl+wheel change it, Ctrl+0 goes back to 100.',
    control: { kind: 'number' },
  },
  {
    key: 'themes.hideContrastWarnings',
    category: 'appearance',
    group: 'Theme colors',
    inEditor: true,
    label: 'Hide contrast warnings',
    description:
      'Leave out the lines in the color editor about text that is hard to read on its background.',
    control: { kind: 'switch' },
  },
  {
    key: 'themes.colorFormat',
    category: 'appearance',
    group: 'Theme colors',
    label: 'Show colors as',
    description: 'How the color editor shows every color. A color you change is written this way.',
    control: {
      kind: 'choice',
      options: [
        { value: 'hex', label: 'Hex (#rrggbb)' },
        { value: 'oklch', label: 'OKLCH' },
      ],
    },
  },
  {
    key: 'editor.wordWrap',
    category: 'editor',
    label: 'Word wrap',
    description: 'Wrap long lines at the edge of the editor instead of scrolling sideways.',
    control: { kind: 'switch' },
  },
  {
    key: 'editor.lineNumbers',
    category: 'editor',
    label: 'Line numbers',
    description: 'Show the line number of each line in a gutter beside the text.',
    control: { kind: 'switch' },
  },
  {
    key: 'editor.limitContentWidth',
    category: 'editor',
    label: 'Limit content width',
    description:
      'Keep the text of a tab to a readable column, centered. On a narrow window it uses the whole width. It needs word wrap, so turning it on turns word wrap on too.',
    control: { kind: 'switch' },
  },
  {
    key: 'editor.contentMaxWidth',
    category: 'editor',
    label: 'Maximum content width',
    description:
      'The widest the text column gets, in pixels. 1024 is about 120 characters at the default size. Used when the limit is on.',
    control: { kind: 'number' },
  },
  {
    key: 'editor.highlightExtensions',
    category: 'editor',
    label: 'Syntax colors',
    description:
      'File types, by extension, that open with syntax colors. Pick a language to add its extensions.',
    control: { kind: 'extensions' },
  },
  {
    key: 'files.largeFileMB',
    category: 'files',
    label: 'Large file size',
    description: 'Files above this many megabytes open as plain text, with no live preview.',
    control: { kind: 'number' },
  },
  {
    key: 'recent.files',
    category: 'files',
    label: 'Recent files',
    description: 'How many files Open Recent remembers. 0 keeps none.',
    control: { kind: 'number' },
  },
  {
    key: 'recent.folders',
    category: 'files',
    label: 'Recent folders',
    description: 'How many folders Open Recent remembers. 0 keeps none.',
    control: { kind: 'number' },
  },
  {
    key: 'images.pasteFolder',
    category: 'files',
    label: 'Image folder',
    description: 'Where pasted and dropped pictures are saved, as a folder beside the document.',
    control: { kind: 'text', placeholder: 'assets' },
  },
  {
    key: 'links.onRename',
    category: 'files',
    label: 'Links on rename',
    description: 'What renaming or moving a file does to the links that point to it.',
    control: {
      kind: 'choice',
      options: [
        { value: 'ask', label: 'Ask each time' },
        { value: 'update', label: 'Update the links' },
        { value: 'never', label: 'Leave the links' },
      ],
    },
  },
  {
    key: 'workspace.excludedFolders',
    category: 'files',
    label: 'Excluded folders',
    description: 'Folders that search, the file index and link checks skip, by name.',
    control: { kind: 'folders' },
  },
  {
    key: 'workspace.hiddenNames',
    category: 'files',
    label: 'Hidden names',
    description:
      'Files and folders the file tree does not show, by name, whatever the case. Search and the file index still see them.',
    control: { kind: 'folders' },
  },
  {
    key: 'git.enabled',
    category: 'files',
    label: 'Use git',
    description: 'Read git to colour changed, new and ignored files in the tree.',
    control: { kind: 'switch' },
    group: 'Git',
  },
  {
    key: 'git.path',
    category: 'files',
    label: 'Git program',
    description:
      'The full path of git. Empty finds it on the PATH and in the usual install folders. Browse picks the program from a file dialog.',
    control: { kind: 'text', placeholder: 'Find automatically', browse: true },
    group: 'Git',
  },
  {
    key: 'devtools',
    category: 'advanced',
    label: 'Developer tools',
    description: 'Allow opening the web inspector (F12). Off by default.',
    control: { kind: 'switch' },
  },
]

/** The rows of one group, in the order they are shown. */
export function rowsOf(category: SettingsCategory): readonly SettingRowSpec[] {
  return SETTING_ROWS.filter((row) => row.category === category && row.drawnIn === undefined)
}

/** The rows whose label, description or key hold the text, whatever the case, across every group. */
export function rowsMatching(query: string): readonly SettingRowSpec[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return SETTING_ROWS.filter((row) => {
    if (row.drawnIn !== undefined) return false
    // A key drawn inside this row is searched for here too: its key and its words.
    const inside = SETTING_ROWS.filter((other) => other.drawnIn === row.key)
      .map((other) => `${other.label} ${other.description} ${other.key}`)
      .join(' ')
    const hay = `${row.label} ${row.description} ${row.key} ${inside}`.toLowerCase()
    return words.every((word) => hay.includes(word))
  })
}
