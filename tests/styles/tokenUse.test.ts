import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_NAMES } from '@/lib/themeTokens'

const root = resolve(import.meta.dirname, '../..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(vue|ts|css)$/.test(name) ? [path] : []
  })
}

/** The code with its comments taken out: a token named in a comment is not used. */
function code(file: string): string {
  const rel = relative(root, file).replaceAll('\\', '/')
  let text = readFileSync(file, 'utf8')
  text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  text = text.replace(/^\s*\/\/.*$/gm, '')
  // The `@theme` lines of tokens.css only rename a token for Tailwind; they are not a use.
  if (rel === 'src/styles/tokens.css') text = text.replace(/^\s*--color-[\w-]+\s*:.*$/gm, '')
  return text
}

/**
 * Every color token is used (ISC-499). The color editor lists 58 tokens, and a token nothing reads
 * (the Selection, the Caret, the split handle and the card text were four) changes nothing when the
 * owner edits it. A use is `var(--token)` or a Tailwind color class for it, outside the theme files
 * that define it and outside the perf lab. This cannot tell a use that is overridden from one that
 * works; the editor tests (`tests/editor/tokenColors.test.ts`) cover the ones that were.
 */
describe('every theme token is used (ISC-499)', () => {
  const files = sources(resolve(root, 'src'))
    .filter((file) => !/[\\/]src[\\/]styles[\\/]themes[\\/]/.test(file))
    .filter((file) => !/[\\/]src[\\/]perf[\\/]/.test(file))
  const texts = files.map(code)
  const CLASS =
    '(?:bg|text|border|ring|fill|stroke|outline|from|to|via|divide|caret|accent|shadow|decoration|placeholder)'

  function users(token: string): string[] {
    const escaped = token.replaceAll('-', '\\-')
    const variable = new RegExp(`var\\(--(?:color-)?${escaped}(?![\\w-])`)
    const utility = new RegExp(`(?<![\\w-])(?:[a-z-]+:)*${CLASS}-${escaped}(?![\\w-])`)
    return files
      .filter((_file, at) => variable.test(texts[at] ?? '') || utility.test(texts[at] ?? ''))
      .map((file) => relative(root, file).replaceAll('\\', '/'))
  }

  it('finds a use for a token it should (the scan is not empty)', () => {
    expect(users('primary').length).toBeGreaterThan(3)
    expect(users('scrollbar-thumb')).toContain('src/styles/tokens.css')
    expect(users('syntax-keyword')).toContain('src/editor/highlight.ts')
  })

  it('has the split handle at --handle at rest and --handle-active under the pointer or dragged (ISC-502)', () => {
    // Another use of --handle (the image handle) would hide this one from the scan above.
    const view = readFileSync(resolve(root, 'src/workbench/SplitNodeView.vue'), 'utf8')
    const classes = /<ResizableHandle[\s\S]*?class="([^"]*)"/.exec(view)?.[1]?.split(/\s+/) ?? []
    expect(classes).toContain('bg-handle')
    expect(classes).toContain('hover:bg-handle-active')
    expect(classes).toContain('data-[state=drag]:bg-handle-active')
  })

  it('has the sidebar edge at --handle at rest and --handle-active when hovered, focused or pressed (ISC-505)', () => {
    const frame = readFileSync(resolve(root, 'src/shell/SidebarFrame.vue'), 'utf8')
    const classes = /data-sidebar-handle\s+class="([^"]*)"/.exec(frame)?.[1]?.split(/\s+/) ?? []
    expect(classes).toContain('bg-handle')
    expect(classes).toContain('hover:bg-handle-active')
    expect(classes).toContain('focus-visible:bg-handle-active')
    expect(classes).toContain('active:bg-handle-active')
    expect(classes.some((name) => name.includes('bg-ring'))).toBe(false)
  })

  it('finds a use for every token', () => {
    const unused = [...THEME_TOKEN_NAMES].filter((token) => users(token).length === 0)
    expect(unused).toEqual([])
  })
})
