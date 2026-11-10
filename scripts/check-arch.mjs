#!/usr/bin/env node
/**
 * Structural checks. One named rule per structural claim in ISA.md.
 *
 *   node scripts/check-arch.mjs                  run every rule
 *   node scripts/check-arch.mjs <rule> [<rule>]  run the named rules
 *   node scripts/check-arch.mjs --list           list the rules
 *   node scripts/check-arch.mjs --root <dir>     check another tree (the tests do this)
 *   node scripts/check-arch.mjs --dist <dir>     also inspect this build (default: <root>/dist)
 *
 * Exit 0 when every selected rule passes, 1 on any violation, 2 on bad usage.
 * Each rule returns violations as { file, line, message }.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.git', 'gen', 'generated'])
const SOURCE_EXTS = ['.ts', '.tsx', '.vue']

/** Relative posix paths of every file under `dir` whose name ends with one of `exts`. */
function walk(root, dir, exts, out = []) {
  const abs = join(root, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, rel, exts, out)
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(rel)
    }
  }
  return out
}

function readText(root, rel) {
  return readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n')
}

function readJson(root, rel) {
  if (!existsSync(join(root, rel))) return undefined
  try {
    return JSON.parse(readText(root, rel))
  } catch {
    return undefined
  }
}

function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++
  return line
}

/** Replaces comments and string literals with spaces, keeping line numbers. */
function blankRust(text) {
  return text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"/g, (m) =>
    m.replace(/[^\n]/g, ' '),
  )
}

/** The text between the parenthesis at `openIndex` and its partner. */
function parenContent(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(openIndex + 1, i)
  }
  return text.slice(openIndex + 1)
}

function firstTopLevelArg(text) {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) return text.slice(0, i)
  }
  return text
}

/** Removes `#` comments from TOML, line by line. */
function stripToml(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s#.*$|^\s*#.*$/, ''))
    .join('\n')
}

/** Dependency names from the `[dependencies]` tables of a Cargo.toml, with line numbers. */
function cargoDependencies(text) {
  const found = []
  let section = ''
  stripToml(text)
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trim()
      const header = line.match(/^\[([^\]]+)\]/)
      if (header) {
        section = header[1] ?? ''
        const inline = section.match(/(?:^|\.)dependencies\.([\w-]+)$/)
        if (inline?.[1]) found.push({ name: inline[1], line: i + 1 })
        return
      }
      if (!/(?:^|\.)dependencies$/.test(section)) return
      const dep = line.match(/^([\w-]+)\s*(?:=|\.)/)
      if (dep?.[1]) found.push({ name: dep[1], line: i + 1 })
    })
  return found
}

function packageDependencyNames(pkg, sections) {
  if (typeof pkg !== 'object' || pkg === null) return []
  return sections.flatMap((section) => Object.keys(pkg[section] ?? {}))
}

/** Specifiers of static and dynamic imports, exports-from and require calls. */
function importSpecifiers(text) {
  const found = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      found.push({
        spec: m[1] ?? '',
        index: m.index,
        kind: pattern.source.includes('import\\s*\\(') ? 'dynamic' : 'static',
      })
    }
  }
  return found
}

const rules = []

function rule(name, summary, check) {
  rules.push({ name, summary, check })
}

// ISC-9
rule(
  'no-os-cfg-outside-platform',
  'cfg(windows), target_os and friends appear only inside src-tauri/src/platform/',
  ({ root }) => {
    const violations = []
    const predicate = /\b(?:windows|unix|target_[a-z_]+|desktop|mobile)\b/
    for (const file of walk(root, 'src-tauri/src', ['.rs'])) {
      if (file.startsWith('src-tauri/src/platform/')) continue
      const text = blankRust(readText(root, file))
      for (const m of text.matchAll(/\bcfg(?:_attr)?\s*!?\s*\(/g)) {
        let inner = parenContent(text, m.index + m[0].length - 1)
        if (m[0].startsWith('cfg_attr')) inner = firstTopLevelArg(inner)
        if (predicate.test(inner)) {
          violations.push({
            file,
            line: lineAt(text, m.index),
            message:
              'OS-specific cfg outside src-tauri/src/platform/; put it behind a platform trait',
          })
        }
      }
    }
    return violations
  },
)

// ISC-12
rule(
  'tauri-only-in-platform',
  '@tauri-apps imports appear only inside src/platform/',
  ({ root }) => {
    const violations = []
    const pattern = /\b(?:from|import|require)\s*\(?\s*['"]@tauri-apps\//g
    for (const file of walk(root, 'src', SOURCE_EXTS)) {
      if (file.startsWith('src/platform/')) continue
      const text = readText(root, file)
      for (const m of text.matchAll(pattern)) {
        violations.push({
          file,
          line: lineAt(text, m.index),
          message: '@tauri-apps import outside src/platform/; add it to the Host interface instead',
        })
      }
    }
    return violations
  },
)

// ISC-13
rule('no-vue-in-editor', 'src/editor/ imports nothing from Vue', ({ root }) => {
  const violations = []
  const vueSpec =
    /^(?:vue|vue\/.+|@vue\/.+|@vueuse\/.+|reka-ui(?:\/.+)?|radix-vue(?:\/.+)?|pinia|vue-router|@\/components\/.+|.+\.vue)$/
  for (const file of walk(root, 'src/editor', [...SOURCE_EXTS, '.js', '.mjs'])) {
    if (file.endsWith('.vue')) {
      violations.push({ file, line: 1, message: 'a .vue file inside src/editor/' })
      continue
    }
    const text = readText(root, file)
    for (const { spec, index } of importSpecifiers(text)) {
      if (vueSpec.test(spec)) {
        violations.push({
          file,
          line: lineAt(text, index),
          message: `src/editor/ imports "${spec}"; the editor stays plain TypeScript`,
        })
      }
    }
  }
  return violations
})

// ISC-14 (closed in P1-T1)
rule('no-hard-coded-colors', 'color literals appear only in src/styles/', ({ root }) => {
  const violations = []
  const hex = /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?!-)/g
  const fn = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/gi
  // Tailwind's own palette (`bg-white`, `text-slate-500`, `border-black/20`) is a color that no
  // theme file can change, so it counts as hard-coded too. Named CSS colors (`red`) are not
  // checked: the word turns up in prose and identifiers far more often than in a color position.
  const palette =
    /(?<![\w-])(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|accent|caret|decoration|shadow|placeholder)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?![\w-])/g
  for (const file of walk(root, 'src', [...SOURCE_EXTS, '.css'])) {
    if (file.startsWith('src/styles/')) continue
    const text = readText(root, file)
    for (const pattern of [hex, fn, palette]) {
      for (const m of text.matchAll(pattern)) {
        const line = lineAt(text, m.index)
        // `<template #default>` is Vue slot syntax, not a color. Only a `#` still inside the
        // opening `<template ...` tag is skipped, so a hex color later on the same line fails.
        const before = text.slice(text.lastIndexOf('\n', m.index - 1) + 1, m.index)
        if (pattern === hex && /<template(?:\s[^>]*)?$/.test(before)) continue
        violations.push({
          file,
          line,
          message:
            pattern === palette
              ? `Tailwind palette class "${m[0]}" outside src/styles/; use a design token class`
              : `color literal "${m[0]}" outside src/styles/; use a design token`,
        })
      }
    }
  }
  return violations
})

// ISC-15 (the claim closes in P10-T2)
rule('no-unsafe-html', 'innerHTML, v-html and friends never appear in src/', ({ root }) => {
  const violations = []
  const pattern =
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|srcdoc)\b|\bv-html\b|\bdocument\.write(?:ln)?\s*\(/g
  for (const file of walk(root, 'src', SOURCE_EXTS)) {
    const text = readText(root, file)
    for (const m of text.matchAll(pattern)) {
      violations.push({
        file,
        line: lineAt(text, m.index),
        message: `"${m[0]}" can inject document content as markup; render text nodes instead`,
      })
    }
  }
  return violations
})

// ISC-20 (the claim closes in P10-T2)
rule(
  'no-network',
  'the CSP and dependencies allow no network path except https images',
  ({ root }) => {
    const violations = []
    const conf = 'src-tauri/tauri.conf.json'
    const config = readJson(root, conf)
    if (config !== undefined) {
      const csp = config?.app?.security?.csp
      const text =
        typeof csp === 'string'
          ? csp
          : csp
            ? Object.entries(csp)
                .map(([k, v]) => `${k} ${String(v)}`)
                .join('; ')
            : ''
      if (!text) {
        violations.push({
          file: conf,
          line: 1,
          message: 'no CSP is set, so the webview can reach any host',
        })
      } else {
        const allowed = new Set([
          "'self'",
          "'none'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "'wasm-unsafe-eval'",
          'ipc:',
          'http://ipc.localhost',
          'asset:',
          'http://asset.localhost',
          'data:',
          'blob:',
        ])
        const directives = text
          .split(';')
          .map((d) => d.trim().split(/\s+/))
          .filter((d) => d[0])
        if (!directives.some((d) => d[0] === 'default-src')) {
          violations.push({
            file: conf,
            line: 1,
            message: 'CSP has no default-src, so other fetch types are open',
          })
        }
        for (const [name, ...sources] of directives) {
          for (const source of sources) {
            if (allowed.has(source) || /^'(?:nonce|sha\d+)-/.test(source)) continue
            if (name === 'img-src' && source === 'https:') continue
            violations.push({
              file: conf,
              line: 1,
              message: `CSP ${name ?? ''} allows ${source}; only img-src may allow https:`,
            })
          }
        }
      }
    }

    const networkNpm =
      /^(?:axios|node-fetch|ky|got|undici|superagent|request|socket\.io-client|ws|isomorphic-fetch|cross-fetch|@tauri-apps\/plugin-(?:http|websocket|updater|upload))$/
    const pkg = readJson(root, 'package.json')
    for (const name of packageDependencyNames(pkg, ['dependencies', 'optionalDependencies'])) {
      if (networkNpm.test(name)) {
        violations.push({
          file: 'package.json',
          line: 1,
          message: `dependency "${name}" makes network requests`,
        })
      }
    }

    const networkCrates =
      /^(?:reqwest|hyper|ureq|isahc|surf|attohttpc|curl|tungstenite|tokio-tungstenite|tauri-plugin-(?:http|websocket|updater|upload))$/
    if (existsSync(join(root, 'src-tauri/Cargo.toml'))) {
      for (const { name, line } of cargoDependencies(readText(root, 'src-tauri/Cargo.toml'))) {
        if (networkCrates.test(name)) {
          violations.push({
            file: 'src-tauri/Cargo.toml',
            line,
            message: `crate "${name}" makes network requests`,
          })
        }
      }
    }

    const calls =
      /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bsendBeacon\b/g
    const remoteCss = /@import\s+(?:url\(\s*)?['"]?https?:|url\(\s*['"]?https?:\/\//g
    for (const file of walk(root, 'src', [...SOURCE_EXTS, '.css'])) {
      const text = readText(root, file)
      const patterns = file.endsWith('.css') ? [remoteCss] : [calls, remoteCss]
      for (const pattern of patterns) {
        for (const m of text.matchAll(pattern)) {
          violations.push({
            file,
            line: lineAt(text, m.index),
            message: `"${m[0].trim()}" reaches the network`,
          })
        }
      }
    }
    return violations
  },
)

// ISC-21
rule('no-plugin-fs', 'tauri-plugin-fs is absent from the dependencies', ({ root }) => {
  const violations = []
  if (existsSync(join(root, 'src-tauri/Cargo.toml'))) {
    const text = stripToml(readText(root, 'src-tauri/Cargo.toml'))
    for (const m of text.matchAll(/\btauri-plugin-fs\b/g)) {
      violations.push({
        file: 'src-tauri/Cargo.toml',
        line: lineAt(text, m.index),
        message: 'tauri-plugin-fs dependency',
      })
    }
  }
  const pkg = readJson(root, 'package.json')
  const names = packageDependencyNames(pkg, [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ])
  if (names.includes('@tauri-apps/plugin-fs')) {
    violations.push({ file: 'package.json', line: 1, message: '@tauri-apps/plugin-fs dependency' })
  }
  for (const file of walk(root, 'src-tauri/capabilities', ['.json'])) {
    const text = readText(root, file)
    for (const m of text.matchAll(/"(fs:[^"]*)"/g)) {
      violations.push({
        file,
        line: lineAt(text, m.index),
        message: `capability "${m[1] ?? ''}" grants the fs plugin`,
      })
    }
  }
  for (const file of walk(root, 'src-tauri/src', ['.rs'])) {
    const text = blankRust(readText(root, file))
    for (const m of text.matchAll(/\btauri_plugin_fs\b/g)) {
      violations.push({ file, line: lineAt(text, m.index), message: 'tauri_plugin_fs used' })
    }
  }
  for (const file of walk(root, 'src', SOURCE_EXTS)) {
    const text = readText(root, file)
    for (const { spec, index } of importSpecifiers(text)) {
      if (spec.startsWith('@tauri-apps/plugin-fs')) {
        violations.push({ file, line: lineAt(text, index), message: 'plugin-fs imported' })
      }
    }
  }
  return violations
})

// ISC-24
rule(
  'suppressions-have-reasons',
  'every lint or type suppression carries a reason comment',
  ({ root }) => {
    const violations = []
    const files = [
      ...walk(root, 'src', [...SOURCE_EXTS, '.js', '.mjs', '.mts']),
      ...walk(root, 'tests', [...SOURCE_EXTS, '.js', '.mjs', '.mts']),
      ...walk(root, 'scripts', ['.js', '.mjs', '.ts']),
      ...['vite.config.ts', 'eslint.config.js'].filter((f) => existsSync(join(root, f))),
    ].filter((f) => !f.startsWith('tests/scripts/') && f !== 'scripts/check-arch.mjs')

    for (const file of files) {
      readText(root, file)
        .split('\n')
        .forEach((line, i) => {
          const eslint = line.match(/eslint-disable(?:-next-line|-line)?\b(.*)$/)
          if (eslint) {
            const rest = (eslint[1] ?? '').replace(/\*\/|-->/g, '')
            if (!/(?:^|\s)--\s+\S/.test(rest)) {
              violations.push({
                file,
                line: i + 1,
                message: 'eslint-disable needs a reason: add " -- why"',
              })
            }
          }
          const ts = line.match(/@ts-(?:ignore|expect-error|nocheck)\b(.*)$/)
          if (ts) {
            const rest = (ts[1] ?? '').replace(/\*\/|-->/g, '').replace(/^[\s:-]+/, '')
            if (!rest.trim()) {
              violations.push({
                file,
                line: i + 1,
                message: 'ts suppression needs a reason after the directive',
              })
            }
          }
        })
    }

    for (const file of walk(root, 'src-tauri/src', ['.rs'])) {
      const lines = readText(root, file).split('\n')
      lines.forEach((line, i) => {
        if (!/#!?\[[^\]\n]*\b(?:allow|expect)\s*\(/.test(line)) return
        if (/reason\s*=\s*"[^"]*\S[^"]*"/.test(line)) return
        if (/\]\s*\/\/(?!\/)\s*\S/.test(line)) return
        if (/^\s*\/\/(?!\/)\s*\S/.test(lines[i - 1] ?? '')) return
        violations.push({
          file,
          line: i + 1,
          message: 'allow/expect needs a reason: a // comment above or after it, or reason = "..."',
        })
      })
    }
    return violations
  },
)

// Generated shadcn-vue components fail exactOptionalPropertyTypes (P0-T9 decisions). `pnpm ui:add`
// (scripts/ui-add.mjs) restores this line after every `add`; the same text lives there.
const UI_MARKER = '// @ts-nocheck -- generated by shadcn-vue, fails exactOptionalPropertyTypes'

rule(
  'ui-files-marked',
  'every .vue file in src/components/ui/ starts its script block with the shadcn-vue ts-nocheck line',
  ({ root }) => {
    const violations = []
    // An opening <script ...> tag; attribute values may hold `>` (generic="T extends A<B>").
    const scriptOpen = /<script\b(?:"[^"]*"|'[^']*'|[^>"'])*>/g
    for (const file of walk(root, 'src/components/ui', ['.vue'])) {
      const text = readText(root, file)
      for (const open of text.matchAll(scriptOpen)) {
        if (/\bsrc\s*=/.test(open[0])) continue
        const tagEnd = open.index + open[0].length
        const bodyStart = text[tagEnd] === '\n' ? tagEnd + 1 : tagEnd
        const lineEnd = text.indexOf('\n', bodyStart)
        const firstLine = text.slice(bodyStart, lineEnd === -1 ? text.length : lineEnd)
        if (firstLine === UI_MARKER) continue
        violations.push({
          file,
          line: lineAt(text, bodyStart),
          message: `generated component without its ts-nocheck line; run "pnpm ui:add --mark-only" (expected first in the script block: ${UI_MARKER})`,
        })
        break
      }
    }
    return violations
  },
)

/**
 * Packages that parse or highlight one language. `@codemirror/lang-markdown` and `@lezer/markdown`
 * are not among them: Markdown is what the editor is for.
 */
const LANGUAGE_PARSER =
  /^(?:@codemirror\/lang-(?!markdown$)[\w-]+|@codemirror\/language-data|@codemirror\/legacy-modes(?:\/.+)?|@lezer\/(?!common$|highlight$|lr$|markdown$)[\w-]+|highlight\.js(?:\/.+)?|prismjs(?:\/.+)?|shiki|@shikijs\/.+)$/

/**
 * The parsers that `@codemirror/lang-markdown` itself imports statically, for the HTML it finds in
 * Markdown (`lang-html`, which brings `lang-css` and `lang-javascript` with it). They are in the entry
 * bundle whatever this app does, so the bundle check does not hold them against it. Checked
 * against the package's own imports on 2026-11-08 (`@codemirror/lang-markdown` 6.5.2).
 */
const MARKDOWN_OWN_PARSERS = new Set([
  '@codemirror/lang-html',
  '@codemirror/lang-css',
  '@codemirror/lang-javascript',
  '@lezer/html',
  '@lezer/css',
  '@lezer/javascript',
])

/** The package a build-map source path belongs to, or null for the app's own files. */
function packageOfSource(source) {
  const path = source.replaceAll('\\', '/')
  const at = path.lastIndexOf('node_modules/')
  if (at === -1) return null
  const m = /^((?:@[^/]+\/)?[^/]+)/.exec(path.slice(at + 'node_modules/'.length))
  return m ? m[1] : null
}

/**
 * The files a page loads before any code of its own runs: the entry script, the modulepreload
 * links, and every chunk those import statically. Chunks reached only by `import()` are not among
 * them, which is the point.
 */
function eagerChunks(distDir) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8')
  const queue = []
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g)) queue.push(m[1])
  for (const m of html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*\bhref="([^"]+\.js)"/g))
    queue.push(m[1])
  const seen = new Set()
  while (queue.length > 0) {
    const rel = (queue.pop() ?? '').replace(/^\.?\//, '')
    if (seen.has(rel) || !existsSync(join(distDir, rel))) continue
    seen.add(rel)
    const text = readFileSync(join(distDir, rel), 'utf8')
    for (const m of text.matchAll(
      /(?:^|[;}\n])\s*(?:import|export)\b[^'"()]*?["']\.\/([^"']+\.js)["']/g,
    )) {
      queue.push(`${dirname(rel) === '.' ? '' : `${dirname(rel)}/`}${m[1]}`)
    }
  }
  return [...seen]
}

/**
 * ISC-71, the build half: no language parser (beyond the ones Markdown brings) in the chunks the
 * page loads first. Reads the source maps of those chunks, so the build must have been made with
 * `vite build --sourcemap`. Returns the problems, or a note saying why nothing was inspected.
 */
function inspectBundle(distDir, explicit) {
  const missing = (message) => ({
    violations: explicit ? [{ file: distDir, line: 1, message }] : [],
    note: message,
  })
  if (!existsSync(join(distDir, 'index.html')))
    return missing('no index.html; build with "pnpm exec vite build --sourcemap"')
  const chunks = eagerChunks(distDir)
  if (chunks.length === 0) return missing('index.html loads no script')
  const violations = []
  for (const chunk of chunks) {
    const mapPath = join(distDir, `${chunk}.map`)
    if (!existsSync(mapPath)) {
      return missing(
        `${chunk} has no source map; build with "pnpm exec vite build --sourcemap --outDir <dir>"`,
      )
    }
    const map = JSON.parse(readFileSync(mapPath, 'utf8'))
    const found = new Set()
    for (const source of map.sources ?? []) {
      const name = packageOfSource(String(source))
      if (name !== null && LANGUAGE_PARSER.test(name) && !MARKDOWN_OWN_PARSERS.has(name))
        found.add(name)
    }
    for (const name of [...found].sort()) {
      violations.push({
        file: `${basename(distDir)}/${chunk}`,
        line: 1,
        message: `"${name}" is in a chunk the page loads first; load it with import() on first use`,
      })
    }
  }
  return { violations, note: '' }
}

// ISC-71
rule(
  'languages-lazy',
  'language parsers are loaded with dynamic import(), never statically, and stay out of the entry bundle',
  ({ root, dist }) => {
    const violations = []
    const parser = LANGUAGE_PARSER
    for (const file of walk(root, 'src', SOURCE_EXTS)) {
      const text = readText(root, file)
      for (const { spec, index, kind } of importSpecifiers(text)) {
        if (kind === 'static' && parser.test(spec)) {
          violations.push({
            file,
            line: lineAt(text, index),
            message: `static import of "${spec}"; load language parsers with import() on first use`,
          })
        }
      }
    }
    const distDir = dist ?? join(root, 'dist')
    const bundle = inspectBundle(distDir, dist !== undefined)
    violations.push(...bundle.violations)
    if (bundle.note !== '' && bundle.violations.length === 0) {
      console.log(`note  languages-lazy: build not inspected (${bundle.note})`)
    }
    return violations
  },
)

// P6-T7: Ctrl+P and Ctrl+Shift+P load on first use
rule(
  'palette-lazy',
  'the picker (PaletteHost.vue and its row code) is loaded with import() on first use, never statically',
  ({ root }) => {
    const violations = []
    const lazy = /(?:^|\/)features\/palette\/(?:PaletteHost\.vue|rows)(?:\.ts)?$/
    for (const file of walk(root, 'src', SOURCE_EXTS)) {
      if (file.startsWith('src/features/palette/')) continue
      const text = readText(root, file)
      for (const { spec, index, kind } of importSpecifiers(text)) {
        if (kind === 'static' && lazy.test(spec)) {
          violations.push({
            file,
            line: lineAt(text, index),
            message: `static import of "${spec}"; the picker loads with import() the first time one opens`,
          })
        }
      }
    }
    return violations
  },
)

// ISC-73
rule(
  'no-math-mermaid',
  'katex, mermaid and mathjax are absent from the dependencies',
  ({ root }) => {
    const pkg = readJson(root, 'package.json')
    const names = packageDependencyNames(pkg, [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ])
    return names
      .filter((name) => /(?:^|[/-])(?:katex|mermaid|mathjax|temml)(?:[/-]|$)/.test(name))
      .map((name) => ({
        file: 'package.json',
        line: 1,
        message: `"${name}" is out of scope for v1`,
      }))
  },
)

// ISC-169
rule('license-mit', 'LICENSE is the MIT text and the manifests say MIT', ({ root }) => {
  const violations = []
  if (!existsSync(join(root, 'LICENSE'))) {
    return [{ file: 'LICENSE', line: 1, message: 'LICENSE file is missing' }]
  }
  const text = readText(root, 'LICENSE').replace(/\s+/g, ' ').trim()
  const required = [
    [/^MIT License /, 'does not start with "MIT License"'],
    [/Copyright \(c\) \d{4} \S/, 'has no "Copyright (c) <year> <holder>" line'],
    [
      /Permission is hereby granted, free of charge, to any person obtaining a copy/,
      'is missing the permission grant',
    ],
    [
      /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/,
      'is missing the warranty disclaimer',
    ],
  ]
  for (const [pattern, problem] of required) {
    if (!pattern.test(text))
      violations.push({ file: 'LICENSE', line: 1, message: `LICENSE ${problem}` })
  }
  const pkg = readJson(root, 'package.json')
  if (pkg?.license !== 'MIT') {
    violations.push({ file: 'package.json', line: 1, message: 'license must be "MIT"' })
  }
  if (existsSync(join(root, 'src-tauri/Cargo.toml'))) {
    if (!/^\s*license\s*=\s*"MIT"/m.test(stripToml(readText(root, 'src-tauri/Cargo.toml')))) {
      violations.push({ file: 'src-tauri/Cargo.toml', line: 1, message: 'license must be "MIT"' })
    }
  }
  return violations
})

function main(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let dist
  const names = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') {
      const value = argv[++i]
      if (!value) return usage('--root needs a directory')
      root = resolve(value)
    } else if (arg === '--dist') {
      const value = argv[++i]
      if (!value) return usage('--dist needs a directory')
      dist = resolve(value)
    } else if (arg === '--list') {
      for (const r of rules) console.log(`${r.name.padEnd(28)} ${r.summary}`)
      return 0
    } else if (arg?.startsWith('--')) {
      return usage(`unknown option ${arg}`)
    } else if (arg) {
      names.push(arg)
    }
  }

  const selected = []
  for (const name of names) {
    const found = rules.find((r) => r.name === name)
    if (!found) return usage(`unknown rule "${name}"`)
    selected.push(found)
  }
  if (selected.length === 0) selected.push(...rules)

  let failed = 0
  for (const r of selected) {
    const violations = r.check({ root, dist })
    if (violations.length === 0) {
      console.log(`ok    ${r.name}`)
      continue
    }
    failed++
    console.error(`FAIL  ${r.name}: ${r.summary}`)
    for (const v of violations) console.error(`        ${v.file}:${String(v.line)}  ${v.message}`)
  }
  return failed === 0 ? 0 : 1
}

function usage(problem) {
  console.error(
    `${problem}\nusage: node scripts/check-arch.mjs [--list] [--root <dir>] [--dist <dir>] [<rule> ...]`,
  )
  return 2
}

process.exitCode = main(process.argv.slice(2))
