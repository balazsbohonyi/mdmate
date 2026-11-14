/**
 * A button beside a single-line input is as tall as the input (ai-docs/standards/vue.md). `Input`
 * and `Button` are both `h-8` by default, so the rule holds until a button is given another size.
 * This scans the Vue templates: from each `<Input`, up to the end of the element that holds it, the
 * first `<Button` must not set a `size` other than the default.
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

/** The `<Button ...>` opening tags that follow an `<Input .../>` inside the same parent and are not the default size. */
export function shortButtonsBesideInputs(text: string): string[] {
  const out: string[] = []
  const input = /<Input\b[^>]*?\/>/gs
  for (let match = input.exec(text); match !== null; match = input.exec(text)) {
    const after = text.slice(match.index + match[0].length)
    const end = after.search(/<\/div>|<\/template>/)
    const siblings = end === -1 ? after : after.slice(0, end)
    const button = /<Button\b[^>]*>/s.exec(siblings)
    if (button !== null && /\ssize\s*=\s*"(?!default")/.test(button[0])) out.push(button[0])
  }
  return out
}

describe('a button beside a single-line input is as tall as the input', () => {
  it('no template gives it another size', () => {
    const offenders = vueFiles(SRC)
      .filter((file) => !file.includes(join('components', 'ui')))
      .flatMap((file) =>
        shortButtonsBesideInputs(readFileSync(file, 'utf8')).map(
          (tag) => `${relative(SRC, file).replaceAll('\\', '/')}: ${tag.replace(/\s+/g, ' ')}`,
        ),
      )
    expect(offenders).toEqual([])
  })

  it('catches a small button after an input, and lets the default one pass', () => {
    const small = '<div><Input v-model="a" /><Button size="sm">Add</Button></div>'
    const plain = '<div><Input v-model="a" /><Button variant="outline">Add</Button></div>'
    expect(shortButtonsBesideInputs(small)).toHaveLength(1)
    expect(shortButtonsBesideInputs(plain)).toEqual([])
  })
})
