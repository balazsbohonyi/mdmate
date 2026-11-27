import { reactive, shallowRef } from 'vue'
import {
  allDocuments,
  describe,
  documentById,
  refreshFromDisk,
  revertDocument,
  saveDocument,
} from '@/documents/store'
import { updateContentWidth } from '@/editor/documentWidth'
import { refreshSourceLanguages } from '@/editor/sourceLanguage'
import { refreshLineNumbers } from '@/editor/lineNumbers'
import { refreshStickyHeadings } from '@/editor/stickyHeadings'
import { refreshWordWrap } from '@/editor/wordWrap'
import type { FileTemplate } from '@/lib/fileTemplate'
import {
  clearSettingsText,
  editSettingsText,
  isBlankFile,
  isUnchanged,
  readRoot,
  type EditResult,
} from '@/lib/settingsEdit'
import {
  describeSyntax,
  getSettingFrom,
  parseSettingsText,
  SETTING_DEFS,
  settingsAfter,
  type SettingKey,
  type SettingValueMap,
} from '@/lib/settingsFile'
import { activeFontPreset, applyCurrentFontPreset } from '@/features/fontPresets/store'
import type { FontPresetId } from '@/lib/fontPresets'
import { cloneSettings, DEFAULT_SETTINGS, settings } from '@/lib/settings'
import { applyCurrentTheme } from '@/features/themes/store'
import { getHost } from '@/platform'
import type { AppliedSettings } from '@/platform/host'
import { reportError, reportWarning } from '@/shell/toasts'
import { settingsTemplate } from './templates'
import { updateZoom } from './zoomApply'

/**
 * `settings.json` as the page lives with it. The file is the source of truth: this module reads it
 * (at start, and each time it changes on disk), checks it with the one validator, and puts the
 * result in `settings`. A change from the screen goes the other way, as an edit of one key of the
 * file's text; the screen holds no value of its own, so a change made on it and a change made by
 * hand in the file always agree.
 */

/** What is known about the file itself, for the screen's banner and its rows. */
export interface SettingsFileState {
  /** The text last read or written, or null when there was no file. */
  text: string | null
  /** Set while the file cannot be used as a whole: not JSON, not an object, or not readable. */
  broken: { readonly message: string; readonly line: number | null } | null
  /** Why a key's value in the file was ignored, by key. The last good value is in use. */
  problems: Partial<Record<SettingKey, string>>
  /** The file has been read at least once. */
  loaded: boolean
}

export const settingsFileState = reactive<SettingsFileState>({
  text: null,
  broken: null,
  problems: {},
  loaded: false,
})

/**
 * The few settings Rust acts on by itself go to it after every change, once each distinct set. They
 * are pushed in order, and `loadSettings` waits for the first push, so Rust holds the file's values
 * before a session is restored or a file is pasted into.
 */
let lastPushed = ''
let pushing: Promise<void> = Promise.resolve()

function runtimeValues(): AppliedSettings {
  return {
    pasteFolder: settings.images.pasteFolder,
    recentFiles: settings.recent.files,
    recentFolders: settings.recent.folders,
    excludedFolders: [...settings.workspace.excludedFolders],
    gitEnabled: settings.git.enabled,
    gitPath: settings.git.path,
    devtools: settings.devtools,
  }
}

function pushRuntime(): void {
  const values = runtimeValues()
  const key = JSON.stringify(values)
  if (key === lastPushed) return
  lastPushed = key
  pushing = pushing.then(async () => {
    try {
      await (await getHost()).settingsApply(values)
    } catch (error) {
      // Rust disagreed with the page about a value: it applied none, and the next change tries again.
      lastPushed = ''
      reportWarning(`Could not apply the settings: ${describe(error)}`)
    }
  })
}

/** Resolves once every push to Rust has been made. */
export function settledRuntime(): Promise<void> {
  return pushing
}

/** Puts `next` into the live settings object field by field, so what reads it stays reactive. */
function assignSettings(next: typeof settings): void {
  settings.theme = next.theme
  Object.assign(settings.fonts, next.fonts)
  Object.assign(settings.editor, next.editor)
  Object.assign(settings.images, next.images)
  Object.assign(settings.links, next.links)
  Object.assign(settings.files, next.files)
  Object.assign(settings.recent, next.recent)
  Object.assign(settings.themes, next.themes)
  Object.assign(settings.git, next.git)
  Object.assign(settings.view, next.view)
  settings.workspace.excludedFolders = next.workspace.excludedFolders
  settings.workspace.hiddenNames = next.workspace.hiddenNames
  settings.devtools = next.devtools
}

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
 * Reads the text of `settings.json` (`null` for no file) and makes it the live settings: a key the
 * file holds a good value for takes it, a key it holds a bad value for keeps its last good value
 * and is flagged, and a key it does not hold goes back to its default. A file that is not one JSON
 * object changes nothing and puts a banner on the screen. Nothing is written.
 */
export function applySettingsText(text: string | null): void {
  settingsFileState.text = text
  settingsFileState.loaded = true
  const parsed = parseSettingsText(text ?? '')
  if (!parsed.ok) {
    settingsFileState.broken = { message: describeSyntax(parsed), line: parsed.spot.line }
    settingsFileState.problems = {}
    notify(`${settingsFileState.broken.message} The last good settings stay in use.`)
    return
  }
  settingsFileState.broken = null
  const problems: Partial<Record<SettingKey, string>> = {}
  for (const problem of parsed.problems) {
    if (problem.key !== null) problems[problem.key] = problem.message
  }
  // A group that is not an object flags every key under it.
  for (const [key, checked] of parsed.present) if (!checked.ok) problems[key] = checked.why
  settingsFileState.problems = problems
  const wrapped = settings.editor.wordWrap
  const numbered = settings.editor.lineNumbers
  const sticky = settings.editor.stickyHeadings
  assignSettings(settingsAfter(settings, parsed))
  if (settings.editor.stickyHeadings !== sticky) refreshStickyHeadings()
  if (settings.editor.wordWrap !== wrapped) refreshWordWrap()
  if (settings.editor.lineNumbers !== numbered) refreshLineNumbers()
  applyCurrentFontPreset()
  updateContentWidth()
  updateZoom()
  refreshSourceLanguages()
  applyCurrentTheme()
  pushRuntime()
  const first = Object.entries(problems)[0]
  notify(
    first === undefined
      ? null
      : `settings.json: ${first[0]}: ${first[1]} The last good value stays in use.`,
  )
}

/** Reads `settings.json` and applies it. A file that cannot be read keeps the last good values. */
export async function loadSettings(): Promise<void> {
  try {
    const host = await getHost()
    applySettingsText(await host.settingsRead())
    await settledRuntime()
  } catch (error) {
    settingsFileState.loaded = true
    settingsFileState.broken = {
      message: `settings.json could not be read: ${describe(error)}`,
      line: null,
    }
    reportWarning(`${settingsFileState.broken.message} The last good settings stay in use.`)
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
export function settledSettings(): Promise<void> {
  return queue.then(
    () => undefined,
    () => undefined,
  )
}

/**
 * Sets one key. Only that key changes in the file: every other key, unknown ones included, stays as
 * it was read, and a value equal to the default takes the key out. The change is applied at once;
 * the file's watcher then finds the text it already holds. Resolves to false, with a notice and
 * nothing written, when the file is not valid JSON (fix it first) or cannot be written.
 *
 * One exception to "only that key": turning the content width limit on also turns word wrap on, in
 * the same write. The limit is the width of wrapped text, so with wrap off it would change the
 * setting and show nothing. Every way to change a setting comes through here (the Settings screen,
 * the command, a row's reset, an answered question), so they agree. Turning the limit off, or
 * changing anything else, leaves word wrap alone, and a hand edit of the file is never rewritten.
 */
/** Every individual font and typography metric key cleared when a preset is selected. */
export const FONT_OVERRIDE_KEYS = [
  'fonts.heading',
  'fonts.body',
  'fonts.code',
  'fonts.size',
  'fonts.lineHeight',
  'fonts.codeSize',
  'fonts.codeLineHeight',
  'fonts.headingScale',
] as const

function matchesActivePresetMetric(key: SettingKey, value: unknown): boolean {
  if (value === null) return false
  const preset = activeFontPreset.value
  if (key === 'fonts.size') return value === preset.size
  if (key === 'fonts.lineHeight') return value === preset.lineHeight
  if (key === 'fonts.codeSize') return value === preset.codeSize
  if (key === 'fonts.codeLineHeight') return value === preset.codeLineHeight
  if (key === 'fonts.headingScale') {
    return (
      Array.isArray(value) &&
      value.length === preset.headingScale.length &&
      value.every((item, i) => item === preset.headingScale[i])
    )
  }
  return false
}

export function changeSetting<K extends SettingKey>(
  key: K,
  value: SettingValueMap[K],
): Promise<boolean> {
  const def = SETTING_DEFS[key]
  const checked = def.check(value)
  if (!checked.ok) {
    reportWarning(`${key}: ${checked.why}`)
    return Promise.resolve(false)
  }
  const normalized = matchesActivePresetMetric(key, checked.value)
    ? (null as SettingValueMap[K])
    : checked.value
  const needsWrap = key === 'editor.limitContentWidth' && normalized === true
  return writeSettings((current, template) => {
    const edited = editSettingsText(
      current,
      def.path,
      def.equals(normalized, def.default) ? undefined : normalized,
      'settings.json',
      template,
    )
    if (!needsWrap || !edited.ok) return edited
    const wrap = SETTING_DEFS['editor.wordWrap']
    return editSettingsText(
      edited.text,
      wrap.path,
      wrap.equals(true, wrap.default) ? undefined : true,
      'settings.json',
      template,
    )
  })
}

/**
 * Applies a font preset and clears all individual font and size overrides in one atomic write, so
 * the chosen preset's families and typography metrics take effect immediately.
 */
export function applyFontPreset(preset: FontPresetId): Promise<boolean> {
  const def = SETTING_DEFS['fonts.preset']
  const checked = def.check(preset)
  if (!checked.ok) {
    reportWarning(`fonts.preset: ${checked.why}`)
    return Promise.resolve(false)
  }
  return writeSettings((current, template) => {
    let edited = editSettingsText(
      current,
      def.path,
      def.equals(checked.value, def.default) ? undefined : checked.value,
      'settings.json',
      template,
    )
    for (const key of FONT_OVERRIDE_KEYS) {
      if (!edited.ok) return edited
      edited = editSettingsText(
        edited.text,
        SETTING_DEFS[key].path,
        undefined,
        'settings.json',
        template,
      )
    }
    return edited
  })
}

/**
 * Takes every entry out of `settings.json`, unknown ones included, and leaves its comments; with
 * the template in the file, each known entry's commented example comes back. Same rules as a change
 * of one key: nothing is written for a file that would not change, or that is not valid JSON.
 */
export function resetAllSettings(): Promise<boolean> {
  return writeSettings((current, template) => clearSettingsText(current, 'settings.json', template))
}

/** Runs one edit of the file's text, one after another with the other writes, and applies it. */
function writeSettings(
  edit: (current: string, template: FileTemplate) => EditResult,
): Promise<boolean> {
  return enqueue(async () => {
    try {
      const host = await getHost()
      const current = await host.settingsRead()
      const template = settingsTemplate()
      const edited = edit(current ?? '', template)
      if (!edited.ok) {
        reportError(edited.message)
        applySettingsText(current)
        return false
      }
      // A file with no change in it is not written again, so its time stamp and the watcher rest.
      const write = !isUnchanged(current, edited.text, template)
      if (write) await host.settingsWrite(edited.text)
      // The file is written, so the change is made whatever happens to an open tab below.
      applySettingsText(edited.text)
      if (write) await refreshOpenSettingsTab()
      return true
    } catch (error) {
      reportError(`Could not save settings.json: ${describe(error)}`)
      return false
    }
  })
}

/** Takes a key out of the file, so its default applies. */
export function resetSetting(key: SettingKey): Promise<boolean> {
  const def = SETTING_DEFS[key]
  return changeSetting(key, def.default as never)
}

/** Which file a reset-all is for: every setting, or every shortcut. */
export type ResetKind = 'settings' | 'shortcuts'

/** A change the screen asked for while the `settings.json` tab holds unsaved edits. */
export interface PendingSettingChange {
  /** The key to change, or null for a reset of every setting. */
  readonly key: SettingKey | null
  readonly value: unknown
  /** When true with `key === 'fonts.preset'`, also clears individual heading/body/code overrides. */
  readonly clearFontOverrides?: true
  /** The document of the tab that holds the edits. */
  readonly docId: number
}

/** Set while the screen waits for Save, Don't save or Cancel before it writes anything. */
export const pendingSettingChange = shallowRef<PendingSettingChange | null>(null)

const pathKey = (path: string): string => path.replaceAll('\\', '/').toLowerCase()

/** The document of `settings.json` when it is open in a tab, with unsaved edits or not. */
async function openSettingsDocument(): Promise<number | undefined> {
  // Only a document named like the file can be it, so the file is not looked up (and made) for nothing.
  const candidates = allDocuments().filter((doc) => doc.name === 'settings.json')
  if (candidates.length === 0) return undefined
  const path = await (await getHost()).settingsFile()
  return candidates.find((doc) => pathKey(doc.path) === pathKey(path))?.id
}

/**
 * Shows the new text in an open `settings.json` tab at once, without waiting for the file watcher.
 * A tab that cannot be refreshed is a notice, not a failed change: the file was written.
 */
async function refreshOpenSettingsTab(): Promise<void> {
  try {
    const open = await openSettingsDocument()
    if (open !== undefined) await refreshFromDisk(open)
  } catch (error) {
    reportWarning(`The settings.json tab could not be refreshed: ${describe(error)}`)
  }
}

/**
 * Makes a `settings.json` that holds nothing (no entries, or `{}`) the commented template, so the
 * file shows what can be added when it is opened. A file with anything in it, or a tab with edits
 * that are not saved, is left alone. A failure is a notice: the file still opens.
 */
export function ensureSettingsTemplate(): Promise<void> {
  return enqueue(async () => {
    try {
      const host = await getHost()
      const current = await host.settingsRead()
      if (!isBlankFile(current)) return
      const template = settingsTemplate()
      if (current === template.text) return
      const unsaved = await unsavedSettingsDocument()
      if (unsaved !== undefined) return
      await host.settingsWrite(template.text)
      applySettingsText(template.text)
      await refreshOpenSettingsTab()
    } catch (error) {
      reportWarning(`Could not add the comments to settings.json: ${describe(error)}`)
    }
  })
}

/** The document of `settings.json` when it is open with edits that are not saved. */
async function unsavedSettingsDocument(): Promise<number | undefined> {
  const id = await openSettingsDocument()
  return id !== undefined && documentById(id)?.dirty === true ? id : undefined
}

/**
 * What a control on the screen calls. With unsaved edits in the `settings.json` tab nothing is
 * written: the change waits in `pendingSettingChange`, since writing the file under those edits
 * would either lose them or lose the change. Resolves to whether the change was written now.
 */
export async function requestSettingChange<K extends SettingKey>(
  key: K,
  value: SettingValueMap[K],
): Promise<boolean> {
  if (await holdForUnsavedEdits((docId) => ({ key, value, docId }))) return false
  return changeSetting(key, value)
}

/** Applies a font preset from the screen, asking first when the `settings.json` tab has unsaved edits. */
export async function requestFontPreset(preset: FontPresetId): Promise<boolean> {
  if (
    await holdForUnsavedEdits((docId) => ({
      key: 'fonts.preset',
      value: preset,
      clearFontOverrides: true,
      docId,
    }))
  ) {
    return false
  }
  return applyFontPreset(preset)
}

/** The same for a reset of every setting, which the Advanced page asks for after a confirmation. */
export async function requestResetAllSettings(): Promise<boolean> {
  if (await holdForUnsavedEdits((docId) => ({ key: null, value: undefined, docId }))) return false
  return resetAllSettings()
}

/**
 * Puts the change in `pendingSettingChange` when the `settings.json` tab has unsaved edits. Resolves
 * to whether the change must wait: a file that cannot be checked counts as waiting, with a notice.
 */
async function holdForUnsavedEdits(
  pending: (docId: number) => PendingSettingChange,
): Promise<boolean> {
  try {
    const docId = await unsavedSettingsDocument()
    if (docId === undefined) return false
    pendingSettingChange.value = pending(docId)
    return true
  } catch (error) {
    reportError(`Could not check settings.json: ${describe(error)}`)
    return true
  }
}

/** Whether the file holds any entry. Comments are not entries; a file that cannot be read is. */
export function settingsHaveEntries(): boolean {
  const text = settingsFileState.text
  if (text === null) return false
  const read = readRoot(text, 'settings.json')
  return !read.ok || Object.keys(read.root).length > 0
}

/** The same, for a row's reset: the default goes through the same question. */
export function requestResetSetting(key: SettingKey): Promise<boolean> {
  return requestSettingChange(key, SETTING_DEFS[key].default as never)
}

/**
 * Answers the question: Save writes the tab's edits to the file first, Don't save reloads the tab
 * from the file and drops them, Cancel leaves everything as it was. Save and Don't save then make
 * the change on top of what the file holds. A save that fails keeps the question open.
 */
export async function resolvePendingSettingChange(
  choice: 'save' | 'discard' | 'cancel',
): Promise<void> {
  const pending = pendingSettingChange.value
  if (pending === null) return
  if (choice === 'cancel') {
    pendingSettingChange.value = null
    return
  }
  // A tab that was closed since the question was asked has no edits left to save or drop.
  const stillOpen = documentById(pending.docId) !== undefined
  const ready = !stillOpen
    ? true
    : choice === 'save'
      ? await saveDocument(pending.docId)
      : await revertDocument(pending.docId)
  if (!ready) return
  pendingSettingChange.value = null
  if (pending.key === null) await resetAllSettings()
  else if (pending.key === 'fonts.preset' && pending.clearFontOverrides === true) {
    await applyFontPreset(pending.value as FontPresetId)
  } else await changeSetting(pending.key, pending.value as never)
}

/** Whether a key currently differs from its default. */
export function isModified(key: SettingKey): boolean {
  const def = SETTING_DEFS[key]
  return !def.equals(getSettingFrom(settings, key) as never, def.default as never)
}

/** Reads the file again after a change on disk, and applies it only when its text is new. */
async function onDiskChange(): Promise<void> {
  // A write of ours may still be on its way: wait for it, so its echo is not read as someone else's.
  await settledSettings()
  try {
    const host = await getHost()
    const text = await host.settingsRead()
    if (settingsFileState.loaded && text === settingsFileState.text) return
    applySettingsText(text)
  } catch (error) {
    reportWarning(`settings.json could not be read: ${describe(error)}`)
  }
}

/** Starts hearing about changes to `settings.json`. Returns the function that stops listening. */
export async function watchSettingsFile(): Promise<() => void> {
  const host = await getHost()
  return host.watchSettings(() => {
    void onDiskChange()
  })
}

/** Back to a file that was never read, for a test. */
export function resetSettingsState(): void {
  settingsFileState.text = null
  settingsFileState.broken = null
  settingsFileState.problems = {}
  settingsFileState.loaded = false
  lastNotice = ''
  pendingSettingChange.value = null
  lastPushed = ''
  pushing = Promise.resolve()
  queue = Promise.resolve()
  Object.assign(settings, cloneSettings(DEFAULT_SETTINGS))
}
