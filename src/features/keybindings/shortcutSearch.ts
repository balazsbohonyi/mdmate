import { COMMAND_GROUPS, type Command, type CommandGroup } from '@/workbench/commands'

/**
 * Finding a command on the Keyboard page. The rule is the Search settings rule (every word of the
 * query is part of the row's text), with one refinement for shortcuts: a word that holds a `+` is a
 * shortcut, and each of its parts must be a whole part of one shortcut. Plain substrings would let
 * `ctrl+s` find every `Ctrl+Shift+...` command; this way it finds Save and Save As only.
 */

/** What a row is found by: the words it shows plus its shortcuts as the page writes them. */
export interface SearchableCommand {
  readonly title: string
  readonly id: string
  readonly group: string
  /** The shortcut now and the default one, as shown (either may be missing). */
  readonly shortcuts: readonly string[]
}

const parts = (shortcut: string): string[] => shortcut.toLowerCase().split('+')

/** Whether the command is found by the query. An empty query finds everything. */
export function matchesShortcutQuery(query: string, command: SearchableCommand): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = [command.title, command.id, command.group, ...command.shortcuts]
    .join('\n')
    .toLowerCase()
  return words.every((word) => {
    const wanted = word.split('+').filter(Boolean)
    if (!word.includes('+') || wanted.length === 0) return text.includes(word)
    return command.shortcuts.some((shortcut) => {
      const have = parts(shortcut)
      return wanted.every((part) => have.includes(part))
    })
  })
}

export interface CommandSection {
  readonly group: CommandGroup
  readonly commands: readonly Command[]
}

/**
 * The commands that the query finds, under their group's heading. Groups come in the fixed order,
 * commands A to Z inside, and a group with nothing to show is left out.
 */
export function commandSections(
  commands: readonly Command[],
  query: string,
  searchable: (command: Command) => SearchableCommand,
): readonly CommandSection[] {
  const sections: CommandSection[] = []
  for (const group of COMMAND_GROUPS) {
    const found = commands
      .filter(
        (command) => command.group === group && matchesShortcutQuery(query, searchable(command)),
      )
      .sort((a, b) => a.title.localeCompare(b.title))
    if (found.length > 0) sections.push({ group, commands: found })
  }
  return sections
}
