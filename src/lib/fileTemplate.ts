/**
 * The commented template of `settings.json` and `keybindings.json`: every setting or shortcut as a
 * `//` line with its default and a few words, so a user who opens the file can see what can be added
 * and adds it by removing the `//`. The same wording is what an edit puts back when it takes an
 * entry out, so a file whose every entry is back at its default reads like the first template
 * (`restoreExample` in `settingsEdit.ts`).
 *
 * Pure text: the tables that say which keys exist live with the settings and the commands, and hand
 * their entries to `buildTemplate`.
 */

export interface TemplateEntry {
  /** Where the key sits in the file: one name, or a group and a name. */
  readonly path: readonly string[]
  /** The default, as JSON text. */
  readonly value: string
  /** A few words on what it does. One line. */
  readonly note: string
}

export interface TemplateSection {
  /** A heading comment over the section, or null for none. */
  readonly title: string | null
  readonly entries: readonly TemplateEntry[]
}

export interface FileTemplate {
  /** The text of a new file: comments only, inside one pair of braces, ending in a newline. */
  readonly text: string
  /** The one-line comment for the key at `path`, or undefined when the template has none. */
  example(path: readonly string[]): string | undefined
  /** The comment lines of the group at `path` (its braces and every key), or undefined. */
  block(path: readonly string[]): readonly string[] | undefined
}

const name = (part: string): string => JSON.stringify(part)
const pathKey = (path: readonly string[]): string => JSON.stringify(path)
const entryLine = (leaf: string, entry: TemplateEntry): string =>
  `// ${name(leaf)}: ${entry.value},  // ${entry.note}`

type Item =
  | { readonly kind: 'flat'; readonly entry: TemplateEntry }
  | { readonly kind: 'group'; readonly group: string; readonly entries: TemplateEntry[] }

/** The text of a comment line without its slashes and with its spaces squeezed, or null. */
export function commentText(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('//')) return null
  return trimmed.slice(2).trim().replace(/\s+/g, ' ')
}

/** Whether the text already holds this comment line, however it is indented. */
export function hasComment(text: string, comment: string): boolean {
  const wanted = commentText(comment)
  if (wanted === null) return false
  return text.split('\n').some((line) => commentText(line) === wanted)
}

/**
 * Builds the template: a header, then each section as comment lines. A key with a path of one name is
 * one line; keys with a group are one block, so removing the slashes from it gives valid JSON.
 */
export function buildTemplate(
  header: readonly string[],
  sections: readonly TemplateSection[],
): FileTemplate {
  const examples = new Map<string, string>()
  const blocks = new Map<string, readonly string[]>()
  const lines: string[] = ['{']
  for (const line of header) lines.push(`  // ${line}`.trimEnd())

  for (const section of sections) {
    const items: Item[] = []
    for (const entry of section.entries) {
      const [first, second, ...more] = entry.path
      if (first === undefined || more.length > 0) {
        throw new Error(`a template key has one or two names, not ${pathKey(entry.path)}`)
      }
      if (examples.has(pathKey(entry.path)))
        throw new Error(`${pathKey(entry.path)} is listed twice`)
      if (second === undefined) {
        items.push({ kind: 'flat', entry })
        examples.set(pathKey(entry.path), entryLine(first, entry))
        continue
      }
      examples.set(pathKey(entry.path), entryLine(second, entry))
      const open = items.find(
        (item): item is Extract<Item, { kind: 'group' }> =>
          item.kind === 'group' && item.group === first,
      )
      if (open === undefined) items.push({ kind: 'group', group: first, entries: [entry] })
      else open.entries.push(entry)
    }

    lines.push('')
    if (section.title !== null) lines.push(`  // ${section.title}`)
    for (const item of items) {
      if (item.kind === 'flat') {
        const line = examples.get(pathKey(item.entry.path))
        if (line !== undefined) lines.push(`  ${line}`)
        continue
      }
      const block = [
        `// ${name(item.group)}: {`,
        ...item.entries.map((entry) => `//   ${entryLine(entry.path[1] ?? '', entry).slice(3)}`),
        '// },',
      ]
      blocks.set(pathKey([item.group]), block)
      for (const line of block) lines.push(`  ${line}`)
    }
  }
  lines.push('}')

  return {
    text: `${lines.join('\n')}\n`,
    example: (path) => examples.get(pathKey(path)),
    block: (path) => blocks.get(pathKey(path)),
  }
}
