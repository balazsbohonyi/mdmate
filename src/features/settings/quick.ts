import { settings } from '@/lib/settings'
import type { SettingKey, SettingValueMap } from '@/lib/settingsFile'
import { openSettingsTab } from '@/workbench/store'
import { pendingSettingChange, requestSettingChange } from './store'

/**
 * Changes a setting for something that is not the Settings screen: a palette command, a menu item
 * or a picker. With unsaved edits in the settings.json tab the store holds the change and asks a
 * question, and that question lives on the Settings screen, so the screen is shown rather than
 * leaving the command to do nothing with no word. Resolves to whether the change was written.
 */
export async function changeSettingFromCommand<K extends SettingKey>(
  key: K,
  value: SettingValueMap[K],
): Promise<boolean> {
  const written = await requestSettingChange(key, value)
  if (!written && pendingSettingChange.value !== null) openSettingsTab()
  return written
}

/** The settings that are one plain on or off, and have a command that flips them. */
export type ToggleKey =
  'editor.wordWrap' | 'editor.lineNumbers' | 'editor.limitContentWidth' | 'devtools'

/** Whether a toggle is on now. Reads the live settings, so a computed or a command state follows it. */
export function isToggleOn(key: ToggleKey): boolean {
  if (key === 'devtools') return settings.devtools
  if (key === 'editor.limitContentWidth') return settings.editor.limitContentWidth
  return key === 'editor.lineNumbers' ? settings.editor.lineNumbers : settings.editor.wordWrap
}

/** Turns a toggle the other way round. */
export function flipSetting(key: ToggleKey): Promise<boolean> {
  return changeSettingFromCommand(key, !isToggleOn(key))
}
