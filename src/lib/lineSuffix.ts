/**
 * `:12` or `:12:5` at the end of a link's path, as `split_line` in `src-tauri/src/links/guard.rs`
 * reads it: plain digits after a plain colon, on something that looks like a path (a dot or a
 * slash, no other colon, a name at the end). Rust decides what a link may do; the page only needs
 * this to know which links name files, and the browser stand-in to follow them.
 */
export interface ColonLine {
  /** The target without the suffix. */
  readonly path: string
  readonly line: number
  readonly column: number | null
}

export function splitColonLine(target: string): ColonLine | null {
  const match = /^([^:]+?):(\d+)(?::(\d+))?$/.exec(target)
  if (match === null) return null
  const [, path = '', line, column] = match
  const name = path.split(/[/\\]/).at(-1) ?? ''
  if (!/[./\\]/.test(path) || ['', '.', '..'].includes(name)) return null
  return { path, line: Number(line), column: column === undefined ? null : Number(column) }
}
