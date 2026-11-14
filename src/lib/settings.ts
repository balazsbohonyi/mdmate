import { reactive } from 'vue'

/**
 * What a rename or move does about the links that point at the file:
 * - `ask`: asks first, with "Yes" as the answer Enter gives, and looks for links only
 *   when told to;
 * - `update`: looks for the links and updates them without asking;
 * - `never`: looks for no links at all; the file is only renamed or moved.
 */
export type LinksOnRename = 'ask' | 'update' | 'never'

/** The values, for checking what comes from outside the page. */
export const LINKS_ON_RENAME: readonly LinksOnRename[] = ['ask', 'update', 'never']

/**
 * The folder names the workspace index, folder search and link scans leave out until the user
 * changes the list. Rust holds the same list (`fs/exclude.rs`, `EXCLUDED_DIRS`) and a test keeps
 * the two equal.
 */
export const BUILT_IN_EXCLUDED_FOLDERS: readonly string[] = [
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  'bin',
  'obj',
  '.vs',
  '.idea',
]

/**
 * The file types shown with syntax colors until the setting says otherwise: the web stack (JS, TS,
 * JSX, TSX, Vue, HTML, CSS and its dialects), Rust's config and data formats, shell and SQL. Every
 * name is one the CodeMirror language list knows, so each has a parser (`codeLanguages.ts`).
 */
export const DEFAULT_HIGHLIGHT_EXTENSIONS: readonly string[] = [
  'json',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'vue',
  'html',
  'css',
  'scss',
  'sass',
  'less',
  'yaml',
  'yml',
  'toml',
  'rs',
  'xml',
  'svg',
  'sh',
  'bash',
  'ps1',
  'sql',
]

/** The heading sizes the editor has always had, as multiples of the body size, H1 to H6. */
export const DEFAULT_HEADING_SCALE: readonly number[] = [1.7, 1.45, 1.25, 1.1, 1, 0.95]

/**
 * The settings the page reads, as they are after `settings.json` is read: the file's value for a
 * key it holds a good value for, the last good value for a key it holds a bad one, and the default
 * for a key it does not hold. Nothing here is set from code except by `features/settings/store`.
 * `links.onRename` can also be set for one run by the `MDMATE_LINKS_ON_RENAME` environment
 * variable, which wins over this object (see `host.linksOnRenameOverride`).
 */
export interface Settings {
  /** `dark`, `light`, `sepia`, `system`, or the name of a theme file. Applied by Phase 8's themes. */
  theme: string
  fonts: {
    /** A font family for headings; empty is the built-in stack. */
    heading: string
    body: string
    code: string
    /** The body size in px. */
    size: number
    /** The size of code in px. */
    codeSize: number
    /** One multiple of the body size for each heading level, H1 to H6. */
    headingScale: readonly number[]
  }
  editor: {
    wordWrap: boolean
    /** The file extensions (no dot, lower case) of non-Markdown files shown with syntax colors. */
    highlightExtensions: readonly string[]
  }
  images: {
    /** Where a pasted or dropped picture goes: a folder name or relative path under the document's folder. */
    pasteFolder: string
  }
  links: {
    onRename: LinksOnRename
  }
  files: {
    /** A file above this many MB opens as plain source. */
    largeFileMB: number
  }
  recent: {
    files: number
    folders: number
  }
  workspace: {
    /** The folder names the workspace index leaves out. */
    excludedFolders: readonly string[]
  }
  devtools: boolean
}

/** The values a fresh install has, and what a removed key goes back to. */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  theme: 'dark',
  fonts: {
    heading: '',
    body: '',
    code: '',
    size: 15,
    codeSize: 14,
    headingScale: DEFAULT_HEADING_SCALE,
  },
  editor: { wordWrap: true, highlightExtensions: DEFAULT_HIGHLIGHT_EXTENSIONS },
  images: { pasteFolder: 'assets' },
  links: { onRename: 'never' },
  files: { largeFileMB: 3 },
  recent: { files: 10, folders: 5 },
  workspace: { excludedFolders: BUILT_IN_EXCLUDED_FOLDERS },
  devtools: false,
}

/** A fresh copy of the defaults, so no caller shares an array with them. */
export function cloneSettings(from: Readonly<Settings>): Settings {
  return {
    theme: from.theme,
    fonts: { ...from.fonts, headingScale: [...from.fonts.headingScale] },
    editor: { ...from.editor, highlightExtensions: [...from.editor.highlightExtensions] },
    images: { ...from.images },
    links: { ...from.links },
    files: { ...from.files },
    recent: { ...from.recent },
    workspace: { excludedFolders: [...from.workspace.excludedFolders] },
    devtools: from.devtools,
  }
}

export const settings = reactive<Settings>(cloneSettings(DEFAULT_SETTINGS))

/** Goes back to the defaults, for a test. */
export function resetSettings(): void {
  Object.assign(settings, cloneSettings(DEFAULT_SETTINGS))
}
