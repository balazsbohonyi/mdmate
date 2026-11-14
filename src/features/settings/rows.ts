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
  | { readonly kind: 'text'; readonly placeholder: string }
  | { readonly kind: 'choice'; readonly options: readonly { value: string; label: string }[] }
  | { readonly kind: 'folders' }

export interface SettingRowSpec {
  readonly key: SettingKey
  readonly category: SettingsCategory
  readonly label: string
  /** One line: what it does and, where it matters, what the value means. */
  readonly description: string
  readonly control: RowControl
}

/** The environment variable that sets what a rename does about links for one run. */
export const LINKS_ENV_VAR = 'MDMATE_LINKS_ON_RENAME'

/** The themes that exist. Light, Sepia and System arrive with the themes (P8-T3). */
export const THEME_CHOICES = [{ value: 'dark', label: 'Dark' }] as const

export const SETTING_ROWS: readonly SettingRowSpec[] = [
  {
    key: 'theme',
    category: 'appearance',
    label: 'Theme',
    description: 'The colours of the whole window.',
    control: { kind: 'choice', options: THEME_CHOICES },
  },
  {
    key: 'editor.wordWrap',
    category: 'editor',
    label: 'Word wrap',
    description: 'Wrap long lines at the edge of the editor instead of scrolling sideways.',
    control: { kind: 'switch' },
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
    key: 'devtools',
    category: 'advanced',
    label: 'Developer tools',
    description: 'Allow opening the web inspector (F12). Off by default.',
    control: { kind: 'switch' },
  },
]

/** The rows of one group, in the order they are shown. */
export function rowsOf(category: SettingsCategory): readonly SettingRowSpec[] {
  return SETTING_ROWS.filter((row) => row.category === category)
}

/** The rows whose label, description or key hold the text, whatever the case, across every group. */
export function rowsMatching(query: string): readonly SettingRowSpec[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return SETTING_ROWS.filter((row) => {
    const hay = `${row.label} ${row.description} ${row.key}`.toLowerCase()
    return words.every((word) => hay.includes(word))
  })
}
