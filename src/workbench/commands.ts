import {
  canonicalKeybinding,
  formatKeybinding,
  matchesKey,
  parseKeybinding,
  type KeyInput,
  type Keybinding,
  type Platform,
} from './keybinding'

/**
 * The command registry. A command is a named action with an optional default shortcut. Shortcuts,
 * the app menu and, later, the palette all find commands here and run them with `runCommand`, so
 * there is one way for a command to run and one place that says whether it can.
 */
export interface Command {
  readonly id: string
  readonly title: string
  /** The default shortcut, as `Mod+Shift+B`. Users override it in Phase 8. */
  readonly keybinding?: string
  /** Disabled commands show greyed out in menus and do nothing when run. Default: always enabled. */
  readonly enabled?: () => boolean
  readonly run: () => void | Promise<void>
}

interface Entry {
  readonly command: Command
  readonly binding: Keybinding | null
}

const entries = new Map<string, Entry>()
const bindingOwners = new Map<string, string>()

/**
 * Adds a command and returns a function that removes it again. Throws when the id is taken, the
 * shortcut does not parse, or another command already holds the same shortcut.
 */
export function registerCommand(command: Command): () => void {
  if (entries.has(command.id)) throw new Error(`Command "${command.id}" is already registered`)
  const binding = command.keybinding === undefined ? null : parseKeybinding(command.keybinding)
  const canonical = binding === null ? null : canonicalKeybinding(binding)
  if (canonical !== null) {
    const owner = bindingOwners.get(canonical)
    if (owner !== undefined) {
      throw new Error(
        `"${command.keybinding}" is held by "${owner}", so "${command.id}" cannot use it`,
      )
    }
    bindingOwners.set(canonical, command.id)
  }
  entries.set(command.id, { command, binding })
  return () => {
    // Only remove what this call added, so a stale disposer cannot take out a newer command.
    if (entries.get(command.id)?.command !== command) return
    entries.delete(command.id)
    if (canonical !== null) bindingOwners.delete(canonical)
  }
}

/** Removes a command and frees its shortcut. Does nothing for an unknown id. */
export function removeCommand(id: string): void {
  const entry = entries.get(id)
  if (entry === undefined) return
  entries.delete(id)
  if (entry.binding !== null) bindingOwners.delete(canonicalKeybinding(entry.binding))
}

/** Empties the registry. Tests use it. */
export function clearCommands(): void {
  entries.clear()
  bindingOwners.clear()
}

export function getCommand(id: string): Command | undefined {
  return entries.get(id)?.command
}

export function listCommands(): readonly Command[] {
  return [...entries.values()].map((entry) => entry.command)
}

export function isCommandEnabled(id: string): boolean {
  const command = getCommand(id)
  return command !== undefined && (command.enabled?.() ?? true)
}

/**
 * Runs a command. Resolves to true when it ran, and to false when it is unknown or disabled. An
 * error thrown by the command itself is passed on.
 */
export async function runCommand(id: string): Promise<boolean> {
  const command = getCommand(id)
  if (command === undefined || !isCommandEnabled(id)) return false
  await command.run()
  return true
}

/** The command whose shortcut is exactly what this event is, if any. */
export function commandForEvent(event: KeyInput, platform: Platform): Command | undefined {
  for (const { command, binding } of entries.values()) {
    if (binding !== null && matchesKey(binding, event, platform)) return command
  }
  return undefined
}

/** A command's shortcut as a menu shows it, or undefined when it has none. */
export function shortcutLabel(id: string, platform: Platform): string | undefined {
  const binding = entries.get(id)?.binding
  return binding ? formatKeybinding(binding, platform) : undefined
}
