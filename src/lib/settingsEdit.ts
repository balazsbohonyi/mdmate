import { stripBom, syntaxSpot, type SyntaxSpot } from './settingsFile'

/**
 * Changing one key of `settings.json` as text. The screen writes only the key it touched, so
 * everything else in the file, unknown keys included, comes back as it was read. The file is
 * strict JSON with a two-space indent and no comments.
 */

export type EditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly message: string; readonly spot: SyntaxSpot }

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The text of an object as the file keeps it. */
export function settingsText(root: Json): string {
  return `${JSON.stringify(root, null, 2)}\n`
}

/** Reads the text as the object it holds. Empty text is an empty object. */
export function readRoot(
  text: string,
  fileName = 'settings.json',
): { ok: true; root: Json } | Extract<EditResult, { ok: false }> {
  const source = stripBom(text)
  if (source.trim() === '') return { ok: true, root: {} }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    return {
      ok: false,
      message: `${fileName} is not valid JSON, so nothing was written. Fix the file first.`,
      spot: syntaxSpot(error, source),
    }
  }
  if (!isObject(value)) {
    return {
      ok: false,
      message: `${fileName} must hold one JSON object, so nothing was written. Fix the file first.`,
      spot: { line: null, column: null },
    }
  }
  return { ok: true, root: value }
}

/**
 * Sets the key at `path` to `value`, or takes the key out when `value` is `undefined`. A group left
 * with no key by that removal goes too, so a file whose every setting is the default is `{}`.
 * A group that was not an object (a wrong value in the file) is replaced by one.
 */
export function editSettingsText(
  text: string,
  path: readonly string[],
  value: unknown,
  fileName = 'settings.json',
): EditResult {
  const read = readRoot(text, fileName)
  if (!read.ok) return read
  const { root } = read
  const last = path[path.length - 1]
  if (last === undefined) return { ok: true, text: settingsText(root) }

  if (value === undefined) {
    // Walk down, remember each object on the way, and take the key out of the deepest.
    const chain: Json[] = [root]
    for (const step of path.slice(0, -1)) {
      const next = chain[chain.length - 1]?.[step]
      if (!isObject(next)) return { ok: true, text: settingsText(root) }
      chain.push(next)
    }
    const deepest = chain[chain.length - 1]
    if (deepest === undefined || !Object.hasOwn(deepest, last)) {
      return { ok: true, text: settingsText(root) }
    }
    delete deepest[last]
    for (let level = chain.length - 1; level > 0; level--) {
      const here = chain[level]
      const parent = chain[level - 1]
      const name = path[level - 1]
      if (here === undefined || parent === undefined || name === undefined) break
      if (Object.keys(here).length > 0) break
      delete parent[name]
    }
    return { ok: true, text: settingsText(root) }
  }

  let at = root
  for (const step of path.slice(0, -1)) {
    const next = at[step]
    if (isObject(next)) {
      at = next
    } else {
      const made: Json = {}
      at[step] = made
      at = made
    }
  }
  at[last] = value
  return { ok: true, text: settingsText(root) }
}
