import { shallowRef } from 'vue'
import {
  bindingText,
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
 *
 * The shortcut a command answers to is its default, or what `keybindings.json` says instead
 * (`setKeybindingOverrides`). The two are resolved together each time either changes.
 */
export interface Command {
  readonly id: string
  readonly title: string
  /** The default shortcut, as `Mod+Shift+B`. `keybindings.json` can replace it. */
  readonly keybinding?: string
  /** Disabled commands show greyed out in menus and do nothing when run. Default: always enabled. */
  readonly enabled?: () => boolean
  /**
   * For a command that flips something: whether it is on right now. The palette and the menu show
   * it as On or Off beside the title. Reads reactive state, like `enabled`.
   */
  readonly state?: () => boolean
  readonly run: () => void | Promise<void>
}

/** Something wrong with the user's shortcuts that was set aside. Never thrown: the file is data. */
export interface KeybindingProblem {
  /** The command ids it is about (one, or the commands that wanted the same shortcut). */
  readonly ids: readonly string[]
  readonly message: string
}

interface Entry {
  readonly command: Command
  readonly defaultBinding: Keybinding | null
}

const entries = new Map<string, Entry>()
/** Default shortcut to the command that has it. Two defaults on one shortcut is a programmer error. */
const defaultOwners = new Map<string, string>()

/** What `keybindings.json` holds, as read: command id to shortcut text or null. */
let overrides: Readonly<Record<string, unknown>> = {}
/** The shortcut each command answers to now, after resolving; null is none. */
let bindings = new Map<string, Keybinding | null>()
/** Shortcut to the command it now belongs to. */
let owners = new Map<string, string>()
let problems: readonly KeybindingProblem[] = []

/** Bumped whenever a shortcut changes, so what shows one (rows, menus, hints) draws it again. */
const version = shallowRef(0)

const titleOf = (id: string): string => entries.get(id)?.command.title ?? id

/** Why an entry of the file is not a shortcut, or the shortcut it holds. */
function readOverride(
  id: string,
  value: unknown,
): { ok: true; binding: Keybinding | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, binding: null }
  if (typeof value !== 'string') {
    return {
      ok: false,
      message: `"${id}": use a shortcut such as "Mod+Shift+B", or null for none.`,
    }
  }
  try {
    return { ok: true, binding: parseKeybinding(value) }
  } catch (error) {
    return {
      ok: false,
      message: `"${id}": ${error instanceof Error ? error.message : String(error)}.`,
    }
  }
}

/**
 * Works out every command's shortcut from the defaults and the file. An entry that is not a
 * shortcut, or names no command, is set aside. A shortcut wanted by two commands goes to neither
 * override: each command that asked for it falls back to its default, and since a default coming
 * back can collide in turn, this repeats until nothing does. The order of the keys in the file
 * means nothing, and a swap of two shortcuts is fine because each command's old shortcut is gone
 * by the time it is compared.
 */
function resolve(): void {
  const found: KeybindingProblem[] = []
  const wanted = new Map<string, Keybinding | null>()
  for (const [id, value] of Object.entries(overrides)) {
    if (!entries.has(id)) {
      found.push({ ids: [id], message: `"${id}" is not a command.` })
      continue
    }
    const read = readOverride(id, value)
    if (read.ok) wanted.set(id, read.binding)
    else found.push({ ids: [id], message: read.message })
  }

  const dropped = new Set<string>()
  for (;;) {
    const next = new Map<string, Keybinding | null>()
    const holders = new Map<string, string[]>()
    for (const [id, entry] of entries) {
      const asked = dropped.has(id) ? undefined : wanted.get(id)
      const binding = asked === undefined ? entry.defaultBinding : asked
      next.set(id, binding)
      if (binding === null) continue
      const key = canonicalKeybinding(binding)
      holders.set(key, [...(holders.get(key) ?? []), id])
    }
    let changed = false
    for (const [key, ids] of holders) {
      if (ids.length < 2) continue
      const losers = ids.filter((id) => !dropped.has(id) && wanted.has(id))
      if (losers.length === 0) continue
      for (const id of losers) dropped.add(id)
      changed = true
      found.push({
        ids,
        message: `${bindingText(parseKeybinding(key))} is wanted by ${ids.map(titleOf).join(' and ')}. ${losers
          .map(titleOf)
          .join(' and ')} keep${losers.length === 1 ? 's' : ''} the default shortcut.`,
      })
    }
    if (!changed) {
      bindings = next
      owners = new Map(
        [...holders].flatMap(([key, ids]) =>
          ids[0] === undefined ? [] : [[key, ids[0]] as const],
        ),
      )
      break
    }
  }
  problems = found
  version.value++
}

/**
 * Adds a command and returns a function that removes it again. Throws when the id is taken, the
 * shortcut does not parse, or another command already holds the same default shortcut.
 */
export function registerCommand(command: Command): () => void {
  if (entries.has(command.id)) throw new Error(`Command "${command.id}" is already registered`)
  const defaultBinding =
    command.keybinding === undefined ? null : parseKeybinding(command.keybinding)
  const canonical = defaultBinding === null ? null : canonicalKeybinding(defaultBinding)
  if (canonical !== null) {
    const owner = defaultOwners.get(canonical)
    if (owner !== undefined) {
      throw new Error(
        `"${command.keybinding}" is held by "${owner}", so "${command.id}" cannot use it`,
      )
    }
    defaultOwners.set(canonical, command.id)
  }
  entries.set(command.id, { command, defaultBinding })
  resolve()
  return () => {
    // Only remove what this call added, so a stale disposer cannot take out a newer command.
    if (entries.get(command.id)?.command !== command) return
    removeCommand(command.id)
  }
}

/** Removes a command and frees its shortcut. Does nothing for an unknown id. */
export function removeCommand(id: string): void {
  const entry = entries.get(id)
  if (entry === undefined) return
  entries.delete(id)
  if (entry.defaultBinding !== null) defaultOwners.delete(canonicalKeybinding(entry.defaultBinding))
  resolve()
}

/** Empties the registry and the user's shortcuts. Tests use it. */
export function clearCommands(): void {
  entries.clear()
  defaultOwners.clear()
  overrides = {}
  resolve()
}

/**
 * Takes the shortcuts the user's file holds: command id to shortcut text, or null for none. The
 * object is whatever the file held, so anything may be in it; what cannot be used is set aside and
 * named by `keybindingProblems`.
 */
export function setKeybindingOverrides(next: Readonly<Record<string, unknown>>): void {
  overrides = { ...next }
  resolve()
}

/** What is wrong with the last shortcuts given, for a notice. Reactive. */
export function keybindingProblems(): readonly KeybindingProblem[] {
  void version.value
  return problems
}

export function getCommand(id: string): Command | undefined {
  return entries.get(id)?.command
}

export function listCommands(): readonly Command[] {
  void version.value
  return [...entries.values()].map((entry) => entry.command)
}

export function isCommandEnabled(id: string): boolean {
  const command = getCommand(id)
  return command !== undefined && (command.enabled?.() ?? true)
}

/** Whether a toggle command is on, or undefined when the command has no state or is unknown. */
export function commandState(id: string): boolean | undefined {
  return getCommand(id)?.state?.()
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
  void version.value
  for (const [id, binding] of bindings) {
    if (binding !== null && matchesKey(binding, event, platform)) return entries.get(id)?.command
  }
  return undefined
}

/** A command's shortcut as a menu shows it, or undefined when it has none. Reactive. */
export function shortcutLabel(id: string, platform: Platform): string | undefined {
  void version.value
  const binding = bindings.get(id)
  return binding ? formatKeybinding(binding, platform) : undefined
}

/** A command's default shortcut, or null when it has none or is unknown. */
export function defaultBindingOf(id: string): Keybinding | null {
  return entries.get(id)?.defaultBinding ?? null
}

/** A command's default shortcut as a menu shows it, or undefined when it has none. */
export function defaultShortcutLabel(id: string, platform: Platform): string | undefined {
  const binding = entries.get(id)?.defaultBinding
  return binding ? formatKeybinding(binding, platform) : undefined
}

/** Whether a command answers to something other than its default shortcut. Reactive. */
export function isRebound(id: string): boolean {
  void version.value
  const entry = entries.get(id)
  if (entry === undefined) return false
  const now = bindings.get(id) ?? null
  const first = entry.defaultBinding
  if (now === null || first === null) return now !== first
  return canonicalKeybinding(now) !== canonicalKeybinding(first)
}

/** The command that answers to this shortcut now, if any. Reactive. */
export function commandHolding(binding: Keybinding): Command | undefined {
  void version.value
  const id = owners.get(canonicalKeybinding(binding))
  return id === undefined ? undefined : entries.get(id)?.command
}
