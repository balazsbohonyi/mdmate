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

/** How the theme color editor writes and shows a color. */
export type ColorFormat = 'hex' | 'oklch'

/** The values, for checking what comes from outside the page. */
export const COLOR_FORMATS: readonly ColorFormat[] = ['hex', 'oklch']

/**
 * The names the file tree does not show, files and folders alike, until the user changes the list
 * (P9.1-T26). Only the tree reads it: search, Quick Open, link scans and the index see these entries
 * as before, and Rust is not told. It is separate from the excluded folders, which would also hide
 * `node_modules`, `dist` and `target`.
 */
export const BUILT_IN_HIDDEN_NAMES: readonly string[] = [
  '.git',
  '.idea',
  '.vscode',
  '.vs',
  '.svn',
  '.hg',
  '.DS_Store',
  'Thumbs.db',
]

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
    /** The line height of the text, headings included, as a multiple of the line's own size. */
    lineHeight: number
    /** The line height of code blocks, as a multiple of the line's own size. */
    codeLineHeight: number
    /** One multiple of the body size for each heading level, H1 to H6. */
    headingScale: readonly number[]
  }
  editor: {
    wordWrap: boolean
    /** Whether each editor shows a gutter with the source line numbers. */
    lineNumbers: boolean
    /** Whether the text column of a tab stops at `contentMaxWidth` and sits in the middle. */
    limitContentWidth: boolean
    /** The widest the text column gets, in px, not counting the padding round it. */
    contentMaxWidth: number
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
    /** The file and folder names the tree does not show, whatever the case. Only the tree reads it. */
    hiddenNames: readonly string[]
  }
  git: {
    /** Whether the tree reads git for the colors of changed, new and ignored files. */
    enabled: boolean
    /** The full path of the git program, or empty to find it on the PATH and in the usual folders. */
    path: string
  }
  themes: {
    /** Whether the color editor leaves out its lines about a pair of colors that is hard to read. */
    hideContrastWarnings: boolean
    /** The format the color editor shows every color in, and writes a changed one in. */
    colorFormat: ColorFormat
  }
  view: {
    /** The zoom of the whole window, in percent (`lib/zoom.ts`). */
    zoom: number
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
    // What CodeMirror's scroller has always given every line (1.4), so the look is unchanged.
    lineHeight: 1.4,
    codeLineHeight: 1.4,
    headingScale: DEFAULT_HEADING_SCALE,
  },
  editor: {
    wordWrap: true,
    lineNumbers: false,
    // 1024 px of text is about 114 to 124 characters of the built-in monospace body font at the
    // default 15 px (Consolas is 0.55 em wide, Courier New 0.6 em).
    limitContentWidth: true,
    contentMaxWidth: 1024,
    highlightExtensions: DEFAULT_HIGHLIGHT_EXTENSIONS,
  },
  images: { pasteFolder: 'assets' },
  links: { onRename: 'never' },
  files: { largeFileMB: 3 },
  recent: { files: 10, folders: 5 },
  workspace: { excludedFolders: BUILT_IN_EXCLUDED_FOLDERS, hiddenNames: BUILT_IN_HIDDEN_NAMES },
  git: { enabled: true, path: '' },
  themes: { hideContrastWarnings: true, colorFormat: 'hex' },
  view: { zoom: 100 },
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
    workspace: {
      excludedFolders: [...from.workspace.excludedFolders],
      hiddenNames: [...from.workspace.hiddenNames],
    },
    git: { ...from.git },
    themes: { ...from.themes },
    view: { ...from.view },
    devtools: from.devtools,
  }
}

export const settings = reactive<Settings>(cloneSettings(DEFAULT_SETTINGS))

/** Goes back to the defaults, for a test. */
export function resetSettings(): void {
  Object.assign(settings, cloneSettings(DEFAULT_SETTINGS))
}
