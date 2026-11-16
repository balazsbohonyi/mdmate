/**
 * The five groups the Settings screen sorts its settings into (P8-T1c). The tab remembers which one
 * is open, so the list lives here, below the workbench and the screen that both read it.
 */
export const SETTINGS_CATEGORIES = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'files', label: 'Files & Workspace' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'advanced', label: 'Advanced' },
] as const

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]['id']

export const DEFAULT_SETTINGS_CATEGORY: SettingsCategory = 'appearance'

/** The category a saved value names, or the first one for anything this version does not know. */
export function readSettingsCategory(value: unknown): SettingsCategory {
  const found = SETTINGS_CATEGORIES.find((category) => category.id === value)
  return found === undefined ? DEFAULT_SETTINGS_CATEGORY : found.id
}

export function settingsCategoryLabel(id: SettingsCategory): string {
  return SETTINGS_CATEGORIES.find((category) => category.id === id)?.label ?? id
}
