import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/** A null body removes that file from the tree a planted case starts from. */
type Files = Record<string, string | null>

interface RuleCase {
  rule: string
  /** A tree the rule must accept. */
  clean: Files
  /** Named trees, each holding one violation the rule must catch. */
  planted: Record<string, Files>
}

const script = resolve(import.meta.dirname, '../../scripts/check-arch.mjs')
const temps: string[] = []

function run(args: string[], files?: Files) {
  const finalArgs = [...args]
  if (files) {
    const dir = mkdtempSync(join(tmpdir(), 'check-arch-'))
    temps.push(dir)
    for (const [rel, body] of Object.entries(files)) {
      if (body === null) continue
      const path = join(dir, rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, body)
    }
    finalArgs.push('--root', dir)
  }
  const result = spawnSync(process.execPath, [script, ...finalArgs], { encoding: 'utf8' })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

const CSP =
  "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost https:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'"

function tauriConf(csp: string | null): string {
  return JSON.stringify({ app: { security: { csp } } })
}

const MIT = `MIT License

Copyright (c) 2026 Someone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED.
`

const pkg = (extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'x', ...extra })

const cases: RuleCase[] = [
  {
    rule: 'no-os-cfg-outside-platform',
    clean: {
      'src-tauri/src/lib.rs':
        '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n// cfg(windows) in a comment is fine\nfn main() { let _s = "target_os"; }\n',
      'src-tauri/src/platform/mod.rs': '#[cfg(target_os = "windows")]\nmod windows;\n',
    },
    planted: {
      'cfg(windows) attribute': { 'src-tauri/src/fs/mod.rs': '#[cfg(windows)]\nfn f() {}\n' },
      'cfg! with target_os': {
        'src-tauri/src/links/mod.rs': 'fn f() -> bool { cfg!(target_os = "linux") }\n',
      },
      'cfg_attr condition': {
        'src-tauri/src/session/mod.rs': '#[cfg_attr(unix, derive(Debug))]\nstruct S;\n',
      },
      'nested in all()': {
        'src-tauri/src/lib.rs': '#[cfg(all(feature = "x", target_family = "unix"))]\nfn f() {}\n',
      },
    },
  },
  {
    rule: 'tauri-only-in-platform',
    clean: {
      'src/platform/tauri.ts': "import { invoke } from '@tauri-apps/api/core'\nvoid invoke\n",
      'src/App.vue': '<script setup lang="ts">\nimport { ref } from "vue"\n</script>\n',
    },
    planted: {
      'static import in a Vue file': {
        'src/App.vue':
          '<script setup lang="ts">\nimport { invoke } from "@tauri-apps/api/core"\n</script>\n',
      },
      'dynamic import': {
        'src/documents/open.ts': "export const w = await import('@tauri-apps/api/window')\n",
      },
      'side-effect import': { 'src/features/x.ts': "import '@tauri-apps/api/event'\n" },
    },
  },
  {
    rule: 'no-vue-in-editor',
    clean: {
      'src/editor/state.ts': "import { EditorState } from '@codemirror/state'\nvoid EditorState\n",
      'src/App.vue': '<script setup lang="ts">\nimport { ref } from "vue"\n</script>\n',
    },
    planted: {
      'imports vue': { 'src/editor/a.ts': "import { ref } from 'vue'\nvoid ref\n" },
      'imports a .vue file': { 'src/editor/b.ts': "import X from './X.vue'\nvoid X\n" },
      'imports a component library': {
        'src/editor/c.ts': "import { Button } from 'reka-ui'\nvoid Button\n",
      },
      'holds a .vue file': { 'src/editor/Widget.vue': '<template><div /></template>\n' },
    },
  },
  {
    rule: 'no-hard-coded-colors',
    clean: {
      'src/styles/tokens.css': ':root { --background: #1e1f22; color: rgb(0 0 0); }\n',
      'src/App.vue':
        '<template><Comp><template #default><div class="bg-background" /></template></Comp></template>\n',
    },
    planted: {
      'hex in TypeScript': { 'src/features/a.ts': "export const c = '#ff0000'\n" },
      'arbitrary Tailwind color': {
        'src/App.vue': '<template><div class="bg-[#fff]" /></template>\n',
      },
      'rgb() in CSS': { 'src/features/b.css': '.a { color: rgb(0 0 0); }\n' },
      'oklch() in a style block': {
        'src/App.vue':
          '<template><div /></template>\n<style>\n.a { color: oklch(0.5 0 0); }\n</style>\n',
      },
    },
  },
  {
    rule: 'no-unsafe-html',
    clean: {
      'src/editor/a.ts': 'export const f = (el: Element, t: string) => { el.textContent = t }\n',
    },
    planted: {
      innerHTML: {
        'src/editor/a.ts': 'export const f = (el: Element, t: string) => { el.innerHTML = t }\n',
      },
      'v-html': { 'src/App.vue': '<template><div v-html="doc" /></template>\n' },
      insertAdjacentHTML: {
        'src/features/a.ts':
          "export const f = (el: Element, t: string) => { el.insertAdjacentHTML('beforeend', t) }\n",
      },
    },
  },
  {
    rule: 'no-network',
    clean: {
      'src-tauri/tauri.conf.json': tauriConf(CSP),
      'package.json': pkg({ dependencies: { vue: '3' } }),
      'src-tauri/Cargo.toml':
        '[dependencies]\ntauri = "2"\n\n[dev-dependencies]\nreqwest = "0.12"\n',
      'src/styles/tokens.css': "@import 'tailwindcss';\n",
      'src/a.ts': 'export const x = 1\n',
    },
    planted: {
      'CSP allows a remote connect-src': {
        'src-tauri/tauri.conf.json': tauriConf(`${CSP}; connect-src https://example.com`),
      },
      'CSP allows https outside img-src': {
        'src-tauri/tauri.conf.json': tauriConf(
          CSP.replace("font-src 'self'", "font-src 'self' https:"),
        ),
      },
      'CSP allows plain http images': {
        'src-tauri/tauri.conf.json': tauriConf(CSP.replace('https:', 'http:')),
      },
      'no CSP': { 'src-tauri/tauri.conf.json': tauriConf(null) },
      'CSP without default-src': {
        'src-tauri/tauri.conf.json': tauriConf("img-src 'self' https:"),
      },
      'http client npm package': {
        'package.json': pkg({ dependencies: { axios: '1' } }),
      },
      'http client crate': { 'src-tauri/Cargo.toml': '[dependencies]\nreqwest = "0.12"\n' },
      'fetch call': { 'src/a.ts': "export const r = fetch('https://example.com')\n" },
      'remote font import': {
        'src/styles/tokens.css': "@import url('https://fonts.googleapis.com/css2?family=Inter');\n",
      },
    },
  },
  {
    rule: 'no-plugin-fs',
    clean: {
      'src-tauri/Cargo.toml': '[dependencies]\ntauri = "2"\n# tauri-plugin-fs stays out\n',
      'package.json': pkg({ dependencies: { '@tauri-apps/api': '2' } }),
      'src-tauri/capabilities/default.json': '{"permissions":["core:default"]}',
    },
    planted: {
      'crate dependency': { 'src-tauri/Cargo.toml': '[dependencies]\ntauri-plugin-fs = "2"\n' },
      'npm dependency': {
        'package.json': pkg({ dependencies: { '@tauri-apps/plugin-fs': '2' } }),
      },
      'fs capability': {
        'src-tauri/capabilities/default.json': '{"permissions":["core:default","fs:default"]}',
      },
      'Rust use': { 'src-tauri/src/lib.rs': 'fn f() { tauri_plugin_fs::init(); }\n' },
      'TypeScript import': {
        'src/a.ts': "import { readFile } from '@tauri-apps/plugin-fs'\nvoid readFile\n",
      },
    },
  },
  {
    rule: 'suppressions-have-reasons',
    clean: {
      'src/a.ts':
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the payload is validated next line\nexport const a = 1 as any\n// @ts-expect-error the mock omits the second argument\nexport const b = f()\n',
      'src-tauri/src/lib.rs':
        '// Needed by the generated bindings.\n#[allow(dead_code)]\nfn a() {}\n#[allow(dead_code)] // kept for the next phase\nfn b() {}\n#[allow(dead_code, reason = "used by tests")]\nfn c() {}\n',
    },
    planted: {
      'eslint-disable without a reason': {
        'src/a.ts': '// eslint-disable-next-line no-console\nconsole.log(1)\n',
      },
      'block eslint-disable': { 'src/a.ts': '/* eslint-disable */\nexport const a = 1\n' },
      'ts-ignore without a reason': { 'src/a.ts': '// @ts-ignore\nexport const a = f()\n' },
      'eslint-disable in a Vue template': {
        'src/App.vue': '<template><div /></template>\n<!-- eslint-disable vue/no-v-html -->\n',
      },
      'allow without a reason': {
        'src-tauri/src/lib.rs': 'fn x() {}\n#[allow(dead_code)]\nfn a() {}\n',
      },
    },
  },
  {
    rule: 'languages-lazy',
    clean: {
      'src/editor/a.ts':
        "import { markdown } from '@codemirror/lang-markdown'\nexport const load = () => import('@codemirror/lang-python')\nvoid markdown\n",
    },
    planted: {
      'static parser import': {
        'src/editor/a.ts': "import { python } from '@codemirror/lang-python'\nvoid python\n",
      },
      'side-effect import': { 'src/editor/b.ts': "import '@codemirror/language-data'\n" },
      're-export of a grammar': { 'src/editor/c.ts': "export { parser } from '@lezer/python'\n" },
      'static highlighter import': {
        'src/editor/d.ts': "import hljs from 'highlight.js'\nvoid hljs\n",
      },
    },
  },
  {
    rule: 'no-math-mermaid',
    clean: { 'package.json': pkg({ dependencies: { vue: '3', 'markdown-it': '14' } }) },
    planted: {
      katex: { 'package.json': pkg({ dependencies: { katex: '0.16' } }) },
      'mermaid in devDependencies': {
        'package.json': pkg({ devDependencies: { mermaid: '11' } }),
      },
      'katex plugin': { 'package.json': pkg({ dependencies: { 'rehype-katex': '7' } }) },
      mathjax: { 'package.json': pkg({ dependencies: { 'mathjax-full': '3' } }) },
    },
  },
  {
    rule: 'license-mit',
    clean: {
      LICENSE: MIT,
      'package.json': pkg({ license: 'MIT' }),
      'src-tauri/Cargo.toml': '[package]\nname = "x"\nlicense = "MIT"\n',
    },
    planted: {
      'missing LICENSE': { LICENSE: null },
      'a different license text': {
        LICENSE: 'Apache License\nVersion 2.0, January 2004\n',
        'package.json': pkg({ license: 'MIT' }),
      },
      'MIT text without a copyright line': {
        LICENSE: MIT.replace('Copyright (c) 2026 Someone', 'All rights reserved'),
        'package.json': pkg({ license: 'MIT' }),
      },
      'package.json says another license': {
        LICENSE: MIT,
        'package.json': pkg({ license: 'ISC' }),
      },
      'Cargo.toml has no license': {
        LICENSE: MIT,
        'package.json': pkg({ license: 'MIT' }),
        'src-tauri/Cargo.toml': '[package]\nname = "x"\n',
      },
    },
  },
]

describe('check-arch rules', () => {
  it.each(cases.map((c) => [c.rule, c] as const))('%s passes a clean tree', (_name, c) => {
    const result = run([c.rule], c.clean)
    expect(result.out).toContain(`ok    ${c.rule}`)
    expect(result.status).toBe(0)
  })

  for (const c of cases) {
    describe(c.rule, () => {
      it.each(Object.entries(c.planted))('fails on: %s', (_label, files) => {
        // A planted violation replaces the clean tree's files of the same name.
        const result = run([c.rule], { ...c.clean, ...files })
        expect(result.out).toContain(`FAIL  ${c.rule}`)
        expect(result.status).toBe(1)
      })
    })
  }
})

describe('check-arch command line', () => {
  it('names every rule the ISA and tasks refer to', () => {
    const result = run(['--list'])
    expect(result.status).toBe(0)
    for (const c of cases) expect(result.out).toContain(c.rule)
  })

  it('has a case for each listed rule', () => {
    const listed = run(['--list'])
      .out.split('\n')
      .map((line) => line.split(/\s+/)[0])
      .filter((name): name is string => Boolean(name))
    expect(listed.sort()).toEqual(cases.map((c) => c.rule).sort())
  })

  it('rejects an unknown rule with exit code 2', () => {
    expect(run(['no-such-rule']).status).toBe(2)
  })

  it('passes every rule on this repository', () => {
    const result = run([])
    expect(result.out).not.toContain('FAIL')
    expect(result.status).toBe(0)
  })
})
