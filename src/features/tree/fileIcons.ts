/**
 * Which icon a file row in the sidebar gets (ISC-576). The icons are a subset of Material Icon Theme
 * (MIT), packed into `public/file-icons.svg` by `scripts/build-file-icons.mjs`; an icon id here is a
 * `<symbol id>` in that sprite. Pure: a name in, an id out. Folder rows keep their Lucide icons.
 */

/** The icon of a file whose type is not known. */
export const DEFAULT_FILE_ICON = 'file'

/** Icons by extension, lower case and without the dot. A double extension such as `d.ts` is one key. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  txt: 'document',
  text: 'document',
  log: 'log',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  csv: 'table',
  tsv: 'table',
  xlsx: 'table',
  ini: 'settings',
  cfg: 'settings',
  conf: 'settings',
  env: 'tune',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  'd.ts': 'typescript-def',
  'd.mts': 'typescript-def',
  'd.cts': 'typescript-def',
  jsx: 'react',
  tsx: 'react_ts',
  vue: 'vue',
  svelte: 'svelte',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'sass',
  sass: 'sass',
  less: 'less',
  rs: 'rust',
  py: 'python',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'h',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  sql: 'database',
  sh: 'console',
  bash: 'console',
  zsh: 'console',
  bat: 'console',
  cmd: 'console',
  ps1: 'powershell',
  wasm: 'webassembly',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  avif: 'image',
  svg: 'svg',
  pdf: 'pdf',
  docx: 'word',
  doc: 'word',
  pptx: 'powerpoint',
  zip: 'zip',
  tar: 'zip',
  gz: 'zip',
  tgz: 'zip',
  '7z': 'zip',
  rar: 'zip',
  lock: 'lock',
  ttf: 'font',
  otf: 'font',
  woff: 'font',
  woff2: 'font',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  exe: 'exe',
  dll: 'dll',
  diff: 'diff',
  patch: 'diff',
}

/** Icons by whole file name, lower case. These win over the extension. */
const NAMES: Readonly<Record<string, string>> = {
  'readme.md': 'readme',
  'readme.txt': 'readme',
  'package.json': 'nodejs',
  'package-lock.json': 'nodejs',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'tsconfig.json': 'tsconfig',
  'jsconfig.json': 'tsconfig',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'vite.config.mjs': 'vite',
  'vitest.config.ts': 'vitest',
  'vitest.config.js': 'vitest',
  'eslint.config.js': 'eslint',
  'eslint.config.mjs': 'eslint',
  'eslint.config.ts': 'eslint',
  '.eslintrc': 'eslint',
  '.eslintrc.json': 'eslint',
  '.eslintrc.js': 'eslint',
  '.prettierrc': 'prettier',
  '.prettierrc.json': 'prettier',
  'prettier.config.js': 'prettier',
  '.prettierignore': 'prettier',
  '.npmrc': 'npm',
  'tauri.conf.json': 'tauri',
  'tailwind.config.js': 'tailwindcss',
  'tailwind.config.ts': 'tailwindcss',
  'cargo.toml': 'rust',
  'cargo.lock': 'rust',
  dockerfile: 'docker',
  '.dockerignore': 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  makefile: 'makefile',
  license: 'license',
  'license.md': 'license',
  'license.txt': 'license',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.editorconfig': 'settings',
  'agents.md': 'agent',
  'claude.md': 'claude',
}

/** Dotfiles that start with one of these (`.env.local`, `.env.production`) get the icon. */
const PREFIXES: readonly (readonly [string, string])[] = [['.env', 'tune']]

/**
 * The icon id of a file name, case-insensitive. A whole-name match wins; then the longest extension
 * (`a.test.d.ts` tries `test.d.ts`, `d.ts`, `ts`); a name nothing matches gets the default icon.
 */
export function fileIconFor(name: string): string {
  const lower = name.toLowerCase()
  const byName = NAMES[lower]
  if (byName !== undefined) return byName
  const prefixed = PREFIXES.find(([prefix]) => lower.startsWith(prefix))
  if (prefixed !== undefined) return prefixed[1]
  // A leading dot is part of the name, not an extension: `.env` has none, `.a.json` has `json`.
  const from = lower.startsWith('.') ? 1 : 0
  for (let dot = lower.indexOf('.', from); dot !== -1; dot = lower.indexOf('.', dot + 1)) {
    const byExtension = EXTENSIONS[lower.slice(dot + 1)]
    if (byExtension !== undefined) return byExtension
  }
  return DEFAULT_FILE_ICON
}

/** Every icon id the map can return, sorted: the symbols `public/file-icons.svg` must hold. */
export function allFileIconIds(): string[] {
  const ids = new Set<string>([DEFAULT_FILE_ICON])
  for (const id of Object.values(EXTENSIONS)) ids.add(id)
  for (const id of Object.values(NAMES)) ids.add(id)
  for (const [, id] of PREFIXES) ids.add(id)
  return [...ids].sort()
}
