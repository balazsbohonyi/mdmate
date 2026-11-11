/**
 * ISC-222 and ISC-226: no tooltip in the app is the browser's native title. Every tooltip is the
 * themed shadcn Tooltip (through the HoverHint wrapper) or, inside the editor, a `data-hint`. This
 * scans the Vue templates and the TypeScript sources, so a new native title fails the build instead
 * of waiting for someone to notice.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

function sources(dir: string, ext: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sources(path, ext))
    else if (entry.name.endsWith(ext)) found.push(path)
  }
  return found
}
const rel = (file: string): string => relative(SRC, file).replaceAll('\\', '/')

/** A `title` attribute written on an element, static or bound: ` title="..."` or ` :title="..."`. */
const NATIVE_TITLE = /(^|\s):?title\s*=/m

/** A title set from code: `el.title = ...`, `setAttribute('title', ...)`, `attributes: { title }`. */
const CODE_TITLE =
  /(?<!this)\.title\s*=(?!=)|setAttribute\(\s*['"]title['"]|attributes:\s*\{[^}]*\btitle\b/

/**
 * The few lines that may set a title. A Markdown image's own title is document content, not app
 * UI; `document.title` inside a test SVG string is not an element; the perf lab is not shipped UI.
 */
const ALLOWED_CODE = [/img\.title = this\.title/, /document\.title = 'SVG-RAN'/]
const ALLOWED_FILES = ['perf/lab.ts']

function codeOffenders(files: { file: string; text: string }[]): string[] {
  const out: string[] = []
  for (const { file, text } of files) {
    if (ALLOWED_FILES.includes(file)) continue
    text.split('\n').forEach((line, i) => {
      if (CODE_TITLE.test(line) && !ALLOWED_CODE.some((ok) => ok.test(line)))
        out.push(`${file}:${String(i + 1)}`)
    })
  }
  return out
}

describe('no native title attribute (ISC-222)', () => {
  const files = sources(SRC, '.vue').filter((file) => !rel(file).startsWith('components/ui/'))

  it('scans the app, not an empty list', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('finds no native title in any template', () => {
    const offenders = files
      .filter((file) => {
        const template = /<template[\s\S]*<\/template>/.exec(readFileSync(file, 'utf8'))?.[0] ?? ''
        return NATIVE_TITLE.test(template)
      })
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('would see one (the pattern itself works)', () => {
    expect(NATIVE_TITLE.test('<div\n  :title="x"\n>')).toBe(true)
    expect(NATIVE_TITLE.test('<div title="x">')).toBe(true)
    expect(NATIVE_TITLE.test('<div data-title="x" aria-label="title">')).toBe(false)
  })
})

describe('no title set from code (ISC-226)', () => {
  const files = sources(SRC, '.ts').map((file) => ({
    file: rel(file),
    text: readFileSync(file, 'utf8'),
  }))

  it('scans the app, not an empty list', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('finds no native title set from code', () => {
    expect(codeOffenders(files)).toEqual([])
  })

  it('would see one (the patterns work, and the allowances are narrow)', () => {
    const see = (text: string): string[] => codeOffenders([{ file: 'x.ts', text }])
    expect(see("pill.title = 'Show'")).toEqual(['x.ts:1'])
    expect(see("el.setAttribute('title', 'x')")).toEqual(['x.ts:1'])
    expect(see("Decoration.mark({ attributes: { title: 'Missing file' } })")).toEqual(['x.ts:1'])
    expect(see('this.title = item.title')).toEqual([])
    expect(see('if (a.title === b.title) return')).toEqual([])
    expect(see('img.title = this.title')).toEqual([])
    expect(see("wrap.title = this.title + 'more'")).toEqual(['x.ts:1'])
  })
})
