import { buildTemplate, type FileTemplate } from '@/lib/fileTemplate'
import { COMMAND_GROUPS, defaultBindingOf, listCommands } from '@/workbench/commands'
import { bindingText } from '@/workbench/keybinding'

/**
 * The commented template of `keybindings.json`: every command, under its group's name as on the
 * Keyboard page, with its default shortcut. A command with no default shows an example key, said so
 * in its note. Built from the command registry each time, so it lists the commands that exist.
 */

const HEADER = [
  'mdmate keyboard shortcuts. Each line below is a command, shown with its default shortcut.',
  'To change one, remove the // in front of it, edit the shortcut and save. Use null for none.',
  'A command you leave out keeps its default. Mod is Ctrl on Windows and Cmd on a Mac.',
  'The Keyboard page in Settings edits this file too and keeps these comments.',
]

/** What a command with no default shortcut shows as its example. */
const EXAMPLE = 'Mod+Shift+F9'

export function keybindingsTemplate(): FileTemplate {
  const commands = listCommands()
  return buildTemplate(
    HEADER,
    COMMAND_GROUPS.flatMap((group) => {
      const entries = commands
        .filter((command) => command.group === group)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((command) => {
          const first = defaultBindingOf(command.id)
          return {
            path: [command.id],
            value: JSON.stringify(first === null ? EXAMPLE : bindingText(first)),
            note:
              first === null
                ? `${command.title}. No default shortcut; the key shown is only an example.`
                : command.title,
          }
        })
      return entries.length === 0 ? [] : [{ title: group, entries }]
    }),
  )
}
