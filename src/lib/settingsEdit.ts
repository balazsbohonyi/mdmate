import { applyEdits, findNodeAtLocation, modify, parseTree } from 'jsonc-parser'
import { hasComment, type FileTemplate } from './fileTemplate'
import { parseObject, stripBom, type SyntaxSpot } from './settingsFile'

/**
 * Changing one key of `settings.json` or `keybindings.json` as text. The screen writes only the key
 * it touched, so everything else in the file (unknown keys, the user's own comments, the template's
 * comments, their layout) comes back as it was read. The files are JSON with comments and trailing
 * commas. A value that is already there is changed in place by `jsonc-parser`; a key is added or
 * taken out by line, because `jsonc-parser` drops the comments above the first property when it
 * removes it and moves a property's own comment when it adds one beside it.
 *
 * Given the file's template, two more things hold: a file that holds nothing yet (no file, blank, or
 * `{}`) is edited from the template, so it is never a bare entry; and an entry taken out gets the
 * template's commented example put back where it was, so a file whose every entry is at its default
 * reads like the first template.
 */

export type EditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly message: string; readonly spot: SyntaxSpot }

type Json = Record<string, unknown>
type TreeNode = NonNullable<ReturnType<typeof parseTree>>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The text of an object as a whole file, for a file made from nothing. */
export function settingsText(root: Json): string {
  return `${JSON.stringify(root, null, 2)}\n`
}

/** Whether the file holds nothing a user wrote: no file, blank text, or an empty object. */
export function isBlankFile(text: string | null): boolean {
  return text === null || /^\s*(\{\s*\})?\s*$/.test(stripBom(text))
}

/**
 * Whether an edit changed nothing, so the file need not be written again (its time stamp and its
 * watcher rest). A file that holds nothing and an edit that leaves nothing is no change, and no
 * file is made for it.
 */
export function isUnchanged(
  current: string | null,
  edited: string,
  template?: FileTemplate,
): boolean {
  if (isBlankFile(current) && isBlankFile(edited)) return true
  const before =
    template !== undefined && isBlankFile(current) ? template.text : stripBom(current ?? '')
  return edited.trimEnd() === before.trimEnd()
}

const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

/** Sets or removes the property at `path` in the text with `jsonc-parser`, changing nothing else. */
function apply(text: string, path: readonly string[], value: unknown): string {
  const edits = modify(text, [...path], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(text) },
  })
  return applyEdits(text, edits)
}

/** The text ending in a newline, and a file whose braces hold nothing at all as `{}`. */
function finished(text: string): string {
  if (/^\s*\{\s*\}\s*$/.test(text)) return '{}\n'
  return text.endsWith('\n') ? text : `${text}${eolOf(text)}`
}

export type ReadResult =
  | {
      readonly ok: true
      /** The object the text holds. */
      readonly root: Json
      /** The text to edit: the text without a byte order mark, and with braces if it had none. */
      readonly text: string
    }
  | Extract<EditResult, { ok: false }>

/** Reads the text as the object it holds. Empty text, or only comments, is an empty object. */
export function readRoot(text: string, fileName = 'settings.json'): ReadResult {
  const source = stripBom(text)
  if (source.trim() === '') return { ok: true, root: {}, text: '{}\n' }
  const parsed = parseObject(source)
  if (parsed.kind === 'syntax') {
    return {
      ok: false,
      message: `${fileName} is not valid JSON, so nothing was written. Fix the file first.`,
      spot: parsed.spot,
    }
  }
  if (parsed.kind === 'not-object') {
    return {
      ok: false,
      message: `${fileName} must hold one JSON object, so nothing was written. Fix the file first.`,
      spot: { line: null, column: null },
    }
  }
  const body = parsed.hasValue ? source : `${source.replace(/\s*$/, '\n')}{}\n`
  return { ok: true, root: parsed.root, text: body }
}

/** The syntax tree of the text, with trailing commas allowed. */
const treeOf = (text: string): TreeNode | undefined =>
  parseTree(text, [], { allowTrailingComma: true })

/**
 * Where a property sits when it has its lines to itself: only blanks before it on its first line,
 * and after it only a comma and a comment. Anything else (two properties on one line) is not that,
 * and the line-based edits leave it to `jsonc-parser`.
 */
function ownLines(
  text: string,
  property: TreeNode,
): { start: number; indent: string; stop: number; next: number } | undefined {
  const start = text.lastIndexOf('\n', property.offset - 1) + 1
  const indent = text.slice(start, property.offset)
  if (!/^[ \t]*$/.test(indent)) return undefined
  const end = property.offset + property.length
  let stop = text.indexOf('\n', end)
  const next = stop < 0 ? text.length : stop + 1
  if (stop < 0) stop = text.length
  if (stop > end && text[stop - 1] === '\r') stop--
  if (!/^[ \t]*,?[ \t]*(\/\/.*)?$/.test(text.slice(end, stop))) return undefined
  return { start, indent, stop, next }
}

/** The property node at `target`, with the object that holds it. */
function propertyAt(
  text: string,
  target: readonly string[],
): { property: TreeNode; parent: TreeNode } | undefined {
  const tree = treeOf(text)
  const property = tree === undefined ? undefined : findNodeAtLocation(tree, [...target])?.parent
  const parent = property?.parent
  if (property?.type !== 'property' || parent === undefined) return undefined
  return { property, parent }
}

/**
 * Puts the template's comment back where the property at `target` is, as it is taken out. It is not
 * done when there is no template for the key, when the comment is already in the file, or when the
 * property does not have its lines to itself (then the plain removal is made). A result that no
 * longer reads is not used either.
 */
function restoreExample(
  text: string,
  target: readonly string[],
  isGroup: boolean,
  template: FileTemplate | undefined,
): string | undefined {
  if (template === undefined) return undefined
  const one = isGroup ? undefined : template.example(target)
  const lines = one !== undefined ? [one] : template.block(target)
  const first = lines?.[0]
  if (lines === undefined || first === undefined) return undefined
  if (hasComment(text, first)) return undefined
  const found = propertyAt(text, target)
  const own = found === undefined ? undefined : ownLines(text, found.property)
  if (own === undefined) return undefined
  const put = lines
    .map((line, index) => (index === 0 ? line : `${own.indent}${line}`))
    .join(eolOf(text))
  const next = `${text.slice(0, own.start)}${own.indent}${put}${text.slice(own.stop)}`
  return parseObject(next).kind === 'ok' ? next : undefined
}

/**
 * Takes the property at `target` out, with the comment on its own line. The comments around it stay.
 * A property that shares its line is left to `jsonc-parser`.
 */
function removeProperty(text: string, target: readonly string[]): string {
  const found = propertyAt(text, target)
  const own = found === undefined ? undefined : ownLines(text, found.property)
  if (found === undefined || own === undefined) return apply(text, target, undefined)
  const { property, parent } = found
  const siblings = parent.children ?? []
  const index = siblings.indexOf(property)
  const kept = `${text.slice(0, own.start)}${text.slice(own.next)}`
  const before = siblings[index - 1]
  if (index !== siblings.length - 1 || before === undefined) return kept
  // The last one goes. In a file that does not use trailing commas, the one that led to it goes too.
  if (/^[ \t]*,/.test(text.slice(property.offset + property.length, own.stop))) return kept
  const end = before.offset + before.length
  const comma = /^[ \t]*,/.exec(text.slice(end))
  return comma === null ? kept : `${kept.slice(0, end)}${kept.slice(end + comma[0].length)}`
}

/**
 * Adds a property after the last one of the object at `parent`, on a line of its own, so the last
 * property's comment stays beside it. Undefined for an object with no property, or a shape this
 * does not handle; the caller then uses `jsonc-parser`.
 */
function appendProperty(
  text: string,
  parent: readonly string[],
  key: string,
  value: unknown,
): string | undefined {
  const tree = treeOf(text)
  const object = parent.length === 0 ? tree : tree && findNodeAtLocation(tree, [...parent])
  const last = object?.type === 'object' ? object.children?.at(-1) : undefined
  if (last === undefined) return undefined
  const own = ownLines(text, last)
  if (own === undefined) return undefined
  const end = last.offset + last.length
  const hasComma = /^[ \t]*,/.test(text.slice(end, own.stop))
  const eol = eolOf(text)
  const body = JSON.stringify(value, null, 2).replaceAll('\n', `${eol}${own.indent}`)
  // A file that ends its lines with commas (as the template does) gets one on the new line too, so a
  // line uncommented below it by hand still reads.
  const line = `${own.indent}${JSON.stringify(key)}: ${body}${hasComma ? ',' : ''}`
  const head = hasComma
    ? text.slice(0, own.stop)
    : `${text.slice(0, end)},${text.slice(end, own.stop)}`
  return `${head}${eol}${line}${text.slice(own.stop)}`
}

/**
 * Takes the property at `path` out. A group left with no property by that goes too, as one, and the
 * template's comment for the key (or for the group) takes its place.
 */
function removeAt(
  text: string,
  path: readonly string[],
  root: Json,
  template: FileTemplate | undefined,
): string {
  const last = path[path.length - 1]
  if (last === undefined) return text
  // The object that holds each name of the path, from the root down.
  const chain: Json[] = [root]
  for (const step of path.slice(0, -1)) {
    const next = chain[chain.length - 1]?.[step]
    if (!isObject(next)) return text
    chain.push(next)
  }
  const deepest = chain[chain.length - 1]
  if (deepest === undefined || !Object.hasOwn(deepest, last)) return text

  let level = path.length
  while (level > 1 && Object.keys(chain[level - 1] ?? {}).length === 1) level--
  const target = path.slice(0, level)
  return restoreExample(text, target, level < path.length, template) ?? removeProperty(text, target)
}

/** Wraps a value in the groups it sits in: `['a', 'b']`, 1 gives `{ a: { b: 1 } }`. */
function nest(names: readonly string[], value: unknown): unknown {
  return names.reduceRight<unknown>((inner, name) => ({ [name]: inner }), value)
}

/** Sets the property at `path`, making the groups on the way, and replacing one that is not a group. */
function setAt(text: string, path: readonly string[], value: unknown, root: Json): string {
  let at: Json = root
  let depth = 0
  while (depth < path.length - 1) {
    const next = at[path[depth] ?? '']
    if (next === undefined) break
    if (!isObject(next)) return apply(apply(text, path.slice(0, depth + 1), {}), path, value)
    at = next
    depth++
  }
  const key = path[depth] ?? ''
  if (depth === path.length - 1 && Object.hasOwn(at, key)) return apply(text, path, value)
  const added = appendProperty(text, path.slice(0, depth), key, nest(path.slice(depth + 1), value))
  if (added !== undefined) return added
  const edited = apply(text, path, value)
  // The first property of an object that holds only comments is in the template's style: with a comma.
  return /\/\/|\/\*/.test(text) ? commaAfter(edited, path.slice(0, depth + 1)) : edited
}

/** Puts a comma after the property at `at` when it has its lines to itself and has none. */
function commaAfter(text: string, at: readonly string[]): string {
  const found = propertyAt(text, at)
  const own = found === undefined ? undefined : ownLines(text, found.property)
  if (found === undefined || own === undefined) return text
  const end = found.property.offset + found.property.length
  if (/^[ \t]*,/.test(text.slice(end, own.stop))) return text
  return `${text.slice(0, end)},${text.slice(end)}`
}

/**
 * Sets the key at `path` to `value`, or takes the key out when `value` is `undefined`. A group left
 * with no key by that removal goes too. A group that was not an object (a wrong value in the file)
 * is replaced by one. With the file's template, a file that holds nothing yet is edited from the
 * template, and a removed entry gets its commented example back.
 */
export function editSettingsText(
  text: string,
  path: readonly string[],
  value: unknown,
  fileName = 'settings.json',
  template?: FileTemplate,
): EditResult {
  const read = readRoot(text, fileName)
  if (!read.ok) return read
  const fresh = template !== undefined && isBlankFile(text)
  const base = fresh ? template.text : read.text
  const root = fresh ? {} : read.root
  if (path.length === 0) return { ok: true, text: finished(base) }
  const edited =
    value === undefined ? removeAt(base, path, root, template) : setAt(base, path, value, root)
  return { ok: true, text: finished(edited) }
}

/**
 * Takes every top-level entry out, unknown ones included, leaving the comments. With the template,
 * each known entry's example comes back where it was. A file that holds nothing is left as it is.
 */
export function clearSettingsText(
  text: string,
  fileName = 'settings.json',
  template?: FileTemplate,
): EditResult {
  const read = readRoot(text, fileName)
  if (!read.ok) return read
  let current = read.text
  for (const name of Object.keys(read.root)) {
    const now = readRoot(current, fileName)
    if (!now.ok) return now
    current = removeAt(current, [name], now.root, template)
  }
  return { ok: true, text: finished(current) }
}
