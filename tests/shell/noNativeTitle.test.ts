/**
 * ISC-222: no tooltip in the app is the browser's native title. Every tooltip is the themed shadcn
 * Tooltip, through the HoverHint wrapper. This scans the Vue sources, so a new native title fails
 * the build instead of waiting for someone to notice.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

function vueFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...vueFiles(path))
    else if (entry.name.endsWith('.vue')) found.push(path)
  }
  return found
}

/** A `title` attribute written on an element, static or bound: ` title="..."` or ` :title="..."`. */
const NATIVE_TITLE = /(^|\s):?title\s*=/m

describe('no native title attribute (ISC-222)', () => {
  const files = vueFiles(SRC).filter(
    (file) => !relative(SRC, file).replaceAll('\\', '/').startsWith('components/ui/'),
  )

  it('scans the app, not an empty list', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('finds no native title in any template', () => {
    const offenders = files
      .filter((file) => {
        const template = /<template[\s\S]*<\/template>/.exec(readFileSync(file, 'utf8'))?.[0] ?? ''
        return NATIVE_TITLE.test(template)
      })
      .map((file) => relative(SRC, file).replaceAll('\\', '/'))
    expect(offenders).toEqual([])
  })

  it('would see one (the pattern itself works)', () => {
    expect(NATIVE_TITLE.test('<div\n  :title="x"\n>')).toBe(true)
    expect(NATIVE_TITLE.test('<div title="x">')).toBe(true)
    expect(NATIVE_TITLE.test('<div data-title="x" aria-label="title">')).toBe(false)
  })
})
