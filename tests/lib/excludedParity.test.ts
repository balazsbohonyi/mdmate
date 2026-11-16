/**
 * The built-in list of excluded folders is written twice: in Rust, where the index uses it, and in
 * the page, where the settings screen shows it and "reset" goes back to it. Two copies of a list
 * drift, so this reads the Rust source and checks they are the same names in the same order.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_EXCLUDED_FOLDERS } from '@/lib/settings'

function rustList(): string[] {
  const source = readFileSync('src-tauri/src/fs/exclude.rs', 'utf8').replace(/\r\n/g, '\n')
  const body = /pub\(crate\) const EXCLUDED_DIRS: &\[&str\] = &\[([\s\S]*?)\];/.exec(source)?.[1]
  if (body === undefined) throw new Error('EXCLUDED_DIRS not found in exclude.rs')
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '')
}

describe('the built-in excluded folders', () => {
  it('are the same names in Rust and in the page', () => {
    expect([...BUILT_IN_EXCLUDED_FOLDERS]).toEqual(rustList())
  })
})
