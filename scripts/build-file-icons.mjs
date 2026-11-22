#!/usr/bin/env node
/**
 * Packs the file-type icons of the sidebar into one sprite, `public/file-icons.svg`.
 *
 *   node --disable-warning=ExperimentalWarning scripts/build-file-icons.mjs <path to the icons folder>
 *
 * The folder is `icons/` of the `material-icon-theme` npm package (MIT, Material Extensions). The
 * package is not a dependency: get it once with `npm pack material-icon-theme`, unpack it, and point
 * this script at its `icons/` folder. The ids come from `src/features/tree/fileIcons.ts`, so the
 * sprite holds exactly the icons that map can return. Every icon becomes a `<symbol id="...">` that
 * keeps its own viewBox, and the ids inside an icon (gradients, clip paths) get the icon's name as a
 * prefix so two icons cannot collide. The output is deterministic: the same input gives the same file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { allFileIconIds } from '../src/features/tree/fileIcons.ts'

const dir = process.argv[2]
if (dir === undefined) {
  console.error('usage: build-file-icons.mjs <path to material-icon-theme/icons>')
  process.exit(2)
}

const symbols = []
for (const id of allFileIconIds()) {
  const svg = readFileSync(join(resolve(dir), `${id}.svg`), 'utf8').trim()
  const open = /^<svg\b([^>]*)>/.exec(svg)
  if (open === null || !svg.endsWith('</svg>')) throw new Error(`${id}.svg is not a plain svg`)
  const viewBox = /\bviewBox="([^"]+)"/.exec(open[1] ?? '')?.[1]
  if (viewBox === undefined) throw new Error(`${id}.svg has no viewBox`)
  let inner = svg.slice(open[0].length, -'</svg>'.length)
  // Some Material icons start with a bare `<path d="M0 0h24v24H0z"/>`, a box with no fill. SVG paints
  // that black, so it shows as a dark square behind the icon on a light sidebar. Drop it.
  inner = inner.replace(/<path d="M0 0h\d+v\d+H0z"\/>/g, '')
  // Make the ids inside this icon its own: `id="a"` and every `url(#a)` or `href="#a"` that uses it.
  for (const match of inner.matchAll(/\bid="([^"]+)"/g)) {
    const old = match[1] ?? ''
    inner = inner.split(`"${old}"`).join(`"${id}-${old}"`)
    inner = inner.split(`#${old})`).join(`#${id}-${old})`)
    inner = inner.split(`"#${old}"`).join(`"#${id}-${old}"`)
  }
  symbols.push(`<symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`)
}

const head = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
writeFileSync(resolve('public/file-icons.svg'), `${head}\n${symbols.join('\n')}\n</svg>\n`)
console.log(`wrote public/file-icons.svg with ${String(symbols.length)} icons`)
