import { reactive, shallowRef } from 'vue'
import {
  allDocuments,
  describe,
  documentById,
  refreshFromDisk,
  revertDocument,
  saveDocument,
} from '@/documents/store'
import {
  clearSettingsText,
  editSettingsText,
  isBlankFile,
  isUnchanged,
  readRoot,
  type EditResult,
} from '@/lib/settingsEdit'
import { getHost } from '@/platform'
import { reportError, reportWarning } from '@/shell/toasts'
import { defaultBindingOf, keybindingProblems, setKeybindingOverrides } from '@/workbench/commands'
import { canonicalKeybinding, parseKeybinding } from '@/workbench/keybinding'
import { keybindingsTemplate } from './template'
import type { FileTemplate } from '@/lib/fileTemplate'

/**
 * `keybindings.json` as the page lives with it, the way `settings.json` is: the file is the source
 * of truth. This module reads it (at start, and each time it changes on disk) and hands what it
 * holds to the command registry, which decides what each shortcut ends up being. A change from the
 * Keyboard category goes the other way, as an edit of the file's text, one command id at a time;
 * the screen keeps no shortcut of its own.
 *
 * The file is one flat object, command id to shortcut text (`"Mod+Shift+B"`) or to `null` for no
 * shortcut. A command id contains dots and stays one key.
 */

const FILE = 'keybindings.json'

/** What is known about the file itself, for the Keyboard category's banner. */
export interface KeybindingsFileState {
  /** The text last read or written, or null when there was no file. */
  text: string | null
  /** Set while the file cannot be used as a whole. The last good shortcuts stay in use. */
  broken: { readonly message: string; readonly line: number | null } | null
  loaded: boolean
}

export const keybindingsFileState = reactive<KeybindingsFileState>({
  text: null,
  broken: null,
  loaded: false,
})

/** The notice for what was wrong, shown once for each distinct thing wrong. */
let lastNotice = ''

function notify(message: string | null): void {
  if (message === null) {
    lastNotice = ''
    return
  }
  if (message === lastNotice) return
  lastNotice = message
  reportWarning(message)
}

/**
 * Reads the text of `keybindings.json` (`null` for no file) and makes its shortcuts live: a command
 * the file names takes that shortcut, one it does not name has its default. A file that is not one
 * JSON object changes nothing and puts a banner on the screen. Nothing is written.
 */
export function applyKeybindingsText(text: string | null): void {
  keybindingsFileState.text = text
  keybindingsFileState.loaded = true
  const read = readRoot(text ?? '', FILE)
  if (!read.ok) {
    keybindingsFileState.broken = { message: read.message, line: read.spot.line }
    notify(`${FILE} could not be used, so the last good shortcuts stay in use. ${read.message}`)
    return
  }
  keybindingsFileState.broken = null
  setKeybindingOverrides(read.root)
  const problems = keybindingProblems()
  const first = problems[0]
  notify(
    first === undefined
      ? null
      : `${FILE}: ${first.message}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}`,
  )
}

/** Reads `keybindings.json` and applies it. A file that cannot be read keeps the last good shortcuts. */
export async function loadKeybindings(): Promise<void> {
  try {
    applyKeybindingsText(await (await getHost()).keybindingsRead())
  } catch (error) {
    keybindingsFileState.loaded = true
    keybindingsFileState.broken = {
      message: `${FILE} could not be read: ${describe(error)}`,
      line: null,
    }
    reportWarning(`${keybindingsFileState.broken.message} The last good shortcuts stay in use.`)
  }
}

/** Writes go one after another, each on top of the file as it is when its turn comes. */
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

/** Resolves once every write that was asked for has been done. Tests use it. */
export function settledKeybindings(): Promise<void> {
  return queue.then(
    () => undefined,
    () => undefined,
  )
}

/**
 * What to do to the file: each id to the shortcut text it gets, to `null` for none, or to
 * `undefined` for no entry (its default). `'all'` empties the file.
 */
export type KeybindingChange = Readonly<Record<string, string | null | undefined>> | 'all'

/** Whether two entries mean the same thing: both none, or the same shortcut. */
function sameAsDefault(id: string, value: string | null): boolean {
  const first = defaultBindingOf(id)
  if (value === null || first === null) return value === null && first === null
  try {
    return canonicalKeybinding(parseKeybinding(value)) === canonicalKeybinding(first)
  } catch {
    return false
  }
}

function textAfter(current: string, change: KeybindingChange, template: FileTemplate): EditResult {
  if (change === 'all') return clearSettingsText(current, FILE, template)
  let text = current
  for (const [id, value] of Object.entries(change)) {
    const entry = value === undefined || sameAsDefault(id, value) ? undefined : value
    const edited = editSettingsText(text, [id], entry, FILE, template)
    if (!edited.ok) return edited
    text = edited.text
  }
  // An empty change still reads the file, so a file that is not JSON is said so.
  if (Object.keys(change).length === 0) {
    const read = readRoot(current, FILE)
    return read.ok ? { ok: true, text: current } : read
  }
  return { ok: true, text }
}

/**
 * Makes the change. Every other key of the file, unknown ids included, stays as it was read, and a
 * shortcut equal to the command's default takes its key out. It is applied at once; the watcher
 * then finds the text it already holds. Resolves to false, with a notice and nothing written, when
 * the file is not valid JSON (fix it first) or cannot be written.
 */
export function changeKeybindings(change: KeybindingChange): Promise<boolean> {
  return enqueue(async () => {
    try {
      const host = await getHost()
      const current = await host.keybindingsRead()
      const template = keybindingsTemplate()
      const edited = textAfter(current ?? '', change, template)
      if (!edited.ok) {
        reportError(edited.message)
        applyKeybindingsText(current)
        return false
      }
      const write = !isUnchanged(current, edited.text, template)
      if (write) await host.keybindingsWrite(edited.text)
      applyKeybindingsText(edited.text)
      if (write) await refreshOpenFile()
      return true
    } catch (error) {
      reportError(`Could not save ${FILE}: ${describe(error)}`)
      return false
    }
  })
}

/**
 * Makes a `keybindings.json` that holds nothing (no entries, or `{}`) the commented template, so
 * the file shows every command and its shortcut when it is opened. A file with anything in it, or a
 * tab with edits that are not saved, is left alone. A failure is a notice: the file still opens.
 */
export function ensureKeybindingsTemplate(): Promise<void> {
  return enqueue(async () => {
    try {
      const host = await getHost()
      const current = await host.keybindingsRead()
      if (!isBlankFile(current)) return
      const template = keybindingsTemplate()
      if (current === template.text) return
      const open = await openDocument()
      if (open !== undefined && documentById(open)?.dirty === true) return
      await host.keybindingsWrite(template.text)
      applyKeybindingsText(template.text)
      await refreshOpenFile()
    } catch (error) {
      reportWarning(`Could not add the comments to ${FILE}: ${describe(error)}`)
    }
  })
}

/** A change the screen asked for while the `keybindings.json` tab holds unsaved edits. */
export interface PendingKeybindingChange {
  readonly change: KeybindingChange
  /** What the change is about, for the question: a command's title, or "all shortcuts". */
  readonly label: string
  /** The document of the tab that holds the edits. */
  readonly docId: number
}

/** Set while the screen waits for Save, Don't save or Cancel before it writes anything. */
export const pendingKeybindingChange = shallowRef<PendingKeybindingChange | null>(null)

const pathKey = (path: string): string => path.replaceAll('\\', '/').toLowerCase()

/** The document of `keybindings.json` when it is open in a tab, with unsaved edits or not. */
async function openDocument(): Promise<number | undefined> {
  const candidates = allDocuments().filter((doc) => doc.name === FILE)
  if (candidates.length === 0) return undefined
  const path = await (await getHost()).keybindingsFile()
  return candidates.find((doc) => pathKey(doc.path) === pathKey(path))?.id
}

/** Shows the new text in an open `keybindings.json` tab at once. A tab that cannot be is a notice. */
async function refreshOpenFile(): Promise<void> {
  try {
    const open = await openDocument()
    if (open !== undefined) await refreshFromDisk(open)
  } catch (error) {
    reportWarning(`The ${FILE} tab could not be refreshed: ${describe(error)}`)
  }
}

/**
 * What a control on the Keyboard category calls. With unsaved edits in the `keybindings.json` tab
 * nothing is written: the change waits in `pendingKeybindingChange`, since writing the file under
 * those edits would lose either them or the change. Resolves to whether it was written now.
 */
export async function requestKeybindingChange(
  change: KeybindingChange,
  label: string,
): Promise<boolean> {
  try {
    const id = await openDocument()
    if (id !== undefined && documentById(id)?.dirty === true) {
      pendingKeybindingChange.value = { change, label, docId: id }
      return false
    }
  } catch (error) {
    reportError(`Could not check ${FILE}: ${describe(error)}`)
    return false
  }
  return changeKeybindings(change)
}

/**
 * Answers the question: Save writes the tab's edits to the file first, Don't save reloads the tab
 * from the file and drops them, Cancel leaves everything as it was. Save and Don't save then make
 * the change on top of what the file holds. A save that fails keeps the question open.
 */
export async function resolvePendingKeybindingChange(
  choice: 'save' | 'discard' | 'cancel',
): Promise<void> {
  const pending = pendingKeybindingChange.value
  if (pending === null) return
  if (choice === 'cancel') {
    pendingKeybindingChange.value = null
    return
  }
  const stillOpen = documentById(pending.docId) !== undefined
  const ready = !stillOpen
    ? true
    : choice === 'save'
      ? await saveDocument(pending.docId)
      : await revertDocument(pending.docId)
  if (!ready) return
  pendingKeybindingChange.value = null
  await changeKeybindings(pending.change)
}

/** Reads the file again after a change on disk, and applies it only when its text is new. */
async function onDiskChange(): Promise<void> {
  await settledKeybindings()
  try {
    const text = await (await getHost()).keybindingsRead()
    if (keybindingsFileState.loaded && text === keybindingsFileState.text) return
    applyKeybindingsText(text)
  } catch (error) {
    reportWarning(`${FILE} could not be read: ${describe(error)}`)
  }
}

/** Starts hearing about changes to `keybindings.json`. Returns the function that stops listening. */
export async function watchKeybindingsFile(): Promise<() => void> {
  const host = await getHost()
  return host.watchKeybindings(() => {
    void onDiskChange()
  })
}

/** Back to a file that was never read, for a test. */
export function resetKeybindingsState(): void {
  keybindingsFileState.text = null
  keybindingsFileState.broken = null
  keybindingsFileState.loaded = false
  lastNotice = ''
  pendingKeybindingChange.value = null
  queue = Promise.resolve()
  setKeybindingOverrides({})
}
