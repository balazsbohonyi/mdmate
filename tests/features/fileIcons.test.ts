// @vitest-environment jsdom
/**
 * File-type icons in the sidebar (ISC-576, ISC-577): the name-to-icon map, the local sprite it
 * points into, and the rows that carry the icon. The look on screen is checked in a browser.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, type App } from 'vue'
import { tooltipApp } from '../helpers/tooltips'
import { resetDocuments } from '@/documents/store'
import { allFileIconIds, DEFAULT_FILE_ICON, fileIconFor } from '@/features/tree/fileIcons'
import FileTree from '@/features/tree/FileTree.vue'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { resetSidebar } from '@/workbench/sidebar'
import { resetWorkbench } from '@/workbench/store'

describe('the icon a file name gets (ISC-576)', () => {
  it('maps common extensions to their icon', () => {
    const cases: [string, string][] = [
      ['notes.md', 'markdown'],
      ['a.txt', 'document'],
      ['data.json', 'json'],
      ['ci.yml', 'yaml'],
      ['ci.yaml', 'yaml'],
      ['Cargo.toml', 'rust'],
      ['main.rs', 'rust'],
      ['app.ts', 'typescript'],
      ['app.js', 'javascript'],
      ['App.vue', 'vue'],
      ['index.html', 'html'],
      ['site.css', 'css'],
      ['run.sh', 'console'],
      ['logo.png', 'image'],
      ['photo.JPG', 'image'],
      ['logo.svg', 'svg'],
      ['paper.pdf', 'pdf'],
      ['backup.zip', 'zip'],
      ['x.py', 'python'],
    ]
    for (const [name, icon] of cases) expect([name, fileIconFor(name)]).toEqual([name, icon])
  })

  it('is case-insensitive', () => {
    expect(fileIconFor('README.MD')).toBe(fileIconFor('readme.md'))
    expect(fileIconFor('Notes.MD')).toBe('markdown')
    expect(fileIconFor('PACKAGE.JSON')).toBe('nodejs')
    expect(fileIconFor('DOCKERFILE')).toBe('docker')
  })

  it('reads the longest known extension of a double extension', () => {
    expect(fileIconFor('types.d.ts')).toBe('typescript-def')
    expect(fileIconFor('a.test.d.ts')).toBe('typescript-def')
    expect(fileIconFor('a.test.ts')).toBe('typescript')
    expect(fileIconFor('bundle.tar.gz')).toBe('zip')
    expect(fileIconFor('x.config.json')).toBe('json')
    expect(fileIconFor('a.b.c.md')).toBe('markdown')
  })

  it('lets a file name beat its extension', () => {
    expect(fileIconFor('package.json')).toBe('nodejs')
    expect(fileIconFor('tsconfig.json')).toBe('tsconfig')
    expect(fileIconFor('pnpm-lock.yaml')).toBe('pnpm')
    expect(fileIconFor('vite.config.ts')).toBe('vite')
    expect(fileIconFor('readme.md')).toBe('readme')
    expect(fileIconFor('Cargo.lock')).toBe('rust')
    expect(fileIconFor('.gitignore')).toBe('git')
    expect(fileIconFor('LICENSE')).toBe('license')
    // The same extension without the special name keeps the type icon.
    expect(fileIconFor('other.json')).toBe('json')
    expect(fileIconFor('notes.md')).toBe('markdown')
  })

  it('treats a leading dot as part of the name, and knows the .env family', () => {
    expect(fileIconFor('.env')).toBe('tune')
    expect(fileIconFor('.env.local')).toBe('tune')
    expect(fileIconFor('.env.production')).toBe('tune')
    expect(fileIconFor('.hidden')).toBe(DEFAULT_FILE_ICON)
    expect(fileIconFor('.hidden.json')).toBe('json')
  })

  it('gives a file it does not know the default icon', () => {
    for (const name of ['unknown.xyz', 'README', 'noextension', 'a.', '.', '', 'archive.']) {
      expect([name, fileIconFor(name)]).toEqual([name, DEFAULT_FILE_ICON])
    }
  })

  it('returns only ids the map lists', () => {
    const ids = new Set(allFileIconIds())
    for (const name of [
      'a.md',
      'b.ts',
      'c.d.ts',
      'package.json',
      '.env',
      'x.unknown',
      'Dockerfile',
    ]) {
      expect(ids.has(fileIconFor(name))).toBe(true)
    }
    expect(ids.has(DEFAULT_FILE_ICON)).toBe(true)
  })
})

describe('the sprite the icons come from (ISC-577)', () => {
  const sprite = readFileSync('public/file-icons.svg', 'utf8')
  const symbolIds = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1] ?? '')

  it('has one symbol for every icon the map can return, and no others', () => {
    expect([...symbolIds].sort()).toEqual(allFileIconIds())
    expect(new Set(symbolIds).size).toBe(symbolIds.length)
  })

  it('gives each symbol a viewBox, so it scales to the 16 px slot', () => {
    expect(sprite.match(/<symbol id="[^"]+" viewBox="[-\d. ]+">/g)?.length).toBe(symbolIds.length)
  })

  it('paints no background box: no symbol has an unfilled path that covers its view box (ISC-662)', () => {
    // An SVG path with no fill is black, so a bare `M0 0h24v24H0z` is a black square behind the icon.
    const symbols = [...sprite.matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)">(.*?)<\/symbol>/gs)]
    const boxes = symbols
      .filter(([, , viewBox = '', inner = '']) => {
        const width = Number(viewBox.split(' ')[2])
        return [...inner.matchAll(/<path([^>]*)>/g)].some(([, attributes = '']) => {
          if (attributes.includes('fill=')) return false
          const box = /d="M0 0h(\d+(?:\.\d+)?)v(\d+(?:\.\d+)?)H0z"/i.exec(attributes)
          return box !== null && Number(box[1]) >= width
        })
      })
      .map(([, id]) => id)
    expect(symbols.length).toBe(symbolIds.length)
    expect(boxes).toEqual([])
  })

  it('holds nothing that loads from the network or runs: no links, scripts, images or handlers', () => {
    expect(sprite).not.toMatch(/https?:\/\/(?!www\.w3\.org\/)/)
    expect(sprite).not.toMatch(/<script|<image|<foreignObject|<style|\bon\w+=/i)
    expect(sprite).not.toMatch(/href="(?!#)/)
  })

  it('keeps the ids inside an icon apart, so two icons cannot take each other a gradient', () => {
    const inner = [...sprite.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1] ?? '')
    const inside = inner.filter((id) => !symbolIds.includes(id))
    expect(new Set(inner).size).toBe(inner.length)
    for (const id of inside) {
      expect(symbolIds.some((symbol) => id.startsWith(`${symbol}-`))).toBe(true)
    }
    // Every reference points at an id that exists.
    for (const match of sprite.matchAll(/url\(#([^)]+)\)/g)) expect(inner).toContain(match[1])
  })

  it('ships the licence of the icons beside the sprite', () => {
    const licence = readFileSync('public/file-icons-LICENSE.txt', 'utf8')
    expect(licence).toContain('The MIT License')
    expect(licence).toContain('Material Extensions')
  })
})

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
async function flush(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await settle()
    await nextTick()
  }
}

describe('a file row in the tree (ISC-576)', () => {
  let mounted: { app: App; root: HTMLElement } | undefined

  beforeEach(async () => {
    resetTree()
    resetDocuments()
    resetWorkbench()
    resetSidebar()
    setHost(
      createMockHost({
        files: {
          '/work/a.md': '# a\n',
          '/work/data.json': '{}\n',
          '/work/lib.rs': 'fn main() {}\n',
          '/work/mystery.xyz': 'x\n',
          '/work/sub/b.ts': 'export {}\n',
        },
        roots: ['/work'],
      }),
    )
    await restoreWorkspace(['/work'])
    await flush()
    const root = document.createElement('div')
    document.body.append(root)
    const app = tooltipApp(FileTree)
    app.mount(root)
    mounted = { app, root }
    await flush()
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = undefined
    document.body.replaceChildren()
    setHost(undefined)
    resetTree()
  })

  const rowIcon = (name: string): string | null | undefined =>
    document.body
      .querySelector(`[data-row-path="/work/${name}"] [data-file-icon]`)
      ?.getAttribute('data-file-icon')

  it('carries the icon of its file type, and the unknown type the default', () => {
    expect(rowIcon('a.md')).toBe('markdown')
    expect(rowIcon('data.json')).toBe('json')
    expect(rowIcon('lib.rs')).toBe('rust')
    expect(rowIcon('mystery.xyz')).toBe(DEFAULT_FILE_ICON)
  })

  it('points the icon at the local sprite', () => {
    const use = document.body.querySelector('[data-row-path="/work/a.md"] svg use')
    expect(use?.getAttribute('href')).toMatch(/^\/?file-icons\.svg#markdown$/)
  })

  it('has no icon on a folder row, which keeps its own', () => {
    const folder = document.body.querySelector('[data-row-path="/work/sub"]')
    expect(folder).not.toBeNull()
    expect(folder?.querySelector('[data-file-icon]')).toBeNull()
    expect(folder?.querySelector('svg')).not.toBeNull()
  })
})
