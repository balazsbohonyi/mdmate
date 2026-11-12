/**
 * What "Find in Folder" puts in "files to include", as VS Code writes it: the folder's path
 * relative to its root with the `./` anchor, so a folder of the same name elsewhere is not
 * matched. A folder is written the same way whatever the row's spelling of slashes.
 *
 * - One root: `./analysis/reports`; the root itself is no filter, so the text is empty.
 * - Two or more roots: the root's folder name comes first (`./KnowledgeBase/analysis`, and
 *   `./KnowledgeBase` for the root itself), so the filter reaches only that root.
 * - Two roots with the same folder name cannot be told apart that way, so the whole path is used.
 *
 * `* ? [ ] { }` in a name are written as one-character classes so they match themselves. A comma
 * cannot be escaped (it splits the list), the same as in VS Code.
 */

const slash = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '')

/** `text` with the characters a pattern would read as wildcards turned into plain ones. */
export function escapeGlob(text: string): string {
  return text.replace(/[*?[\]{}]/g, '[$&]')
}

/**
 * The include text for the folder `path`, which lies in `root` (or is it). `roots` are all the
 * workspace roots; `same` says whether two names or paths are the same place on this system.
 */
export function includeForFolder(
  path: string,
  root: string,
  roots: readonly string[],
  same: (a: string, b: string) => boolean,
): string {
  const base = slash(root)
  const full = slash(path)
  const relative = full.length > base.length ? full.slice(base.length + 1) : ''
  if (roots.length < 2) return relative === '' ? '' : `./${escapeGlob(relative)}`
  const name = base.split('/').pop() ?? ''
  const twins = roots.filter((other) => same(slash(other).split('/').pop() ?? '', name)).length
  if (name === '' || twins > 1) return escapeGlob(full)
  return `./${escapeGlob(name)}${relative === '' ? '' : `/${escapeGlob(relative)}`}`
}

/**
 * Where a search looks, in a few words for the result line: `in ./docs`, `excluding *.txt`, or
 * both joined by a comma; empty when neither box has text. Text is shown as typed, trimmed.
 */
export function scopeText(include: string, exclude: string): string {
  const parts: string[] = []
  if (include.trim() !== '') parts.push(`in ${include.trim()}`)
  if (exclude.trim() !== '') parts.push(`excluding ${exclude.trim()}`)
  return parts.join(', ')
}
