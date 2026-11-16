import { buildTemplate, type FileTemplate, type TemplateEntry } from '@/lib/fileTemplate'
import { SETTINGS_CATEGORIES } from '@/lib/settingsCategories'
import { SETTING_DEFS } from '@/lib/settingsFile'
import { SETTING_ROWS } from './rows'

/**
 * The commented template of `settings.json`: every setting with its default and the row's one-line
 * description, in the order and under the headings of the Settings screen. Built from the same two
 * tables the screen reads (`SETTING_DEFS` for the file path and the default, `SETTING_ROWS` for the
 * wording), so a new setting reaches the template when it reaches the screen.
 */

const HEADER = [
  'mdmate settings. Each line below is a setting, shown with its default value.',
  'To change one, remove the // in front of it, edit the value and save.',
  'A setting you leave out keeps its default. Trailing commas are fine.',
  'The Settings screen edits this file too and keeps these comments.',
]

let built: FileTemplate | undefined

export function settingsTemplate(): FileTemplate {
  built ??= buildTemplate(
    HEADER,
    SETTINGS_CATEGORIES.flatMap((category) => {
      const entries: TemplateEntry[] = SETTING_ROWS.filter(
        (row) => row.category === category.id,
      ).map((row) => ({
        path: SETTING_DEFS[row.key].path,
        value: JSON.stringify(SETTING_DEFS[row.key].default),
        note: row.description,
      }))
      return entries.length === 0 ? [] : [{ title: category.label, entries }]
    }),
  )
  return built
}
