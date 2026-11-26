/**
 * Where the app uses each theme token, in a sentence or two, for the hover hint on a row of the
 * color editor. The sentences were written from the code that uses each token (the Tailwind
 * utilities and `var(--token)` in `src`), so a change that moves a token to another place should
 * change its sentence. `tests/lib/themeTokenUsage.test.ts` fails when a token has no sentence or a
 * sentence names a token that does not exist.
 */

export const THEME_TOKEN_USAGE: Readonly<Record<string, string>> = {
  // Core
  background:
    'The page behind everything: the editor, empty panes, and the fill of most fields and screens.',
  foreground:
    'The main text color: document text, labels, and any text that has no more specific color.',
  card: 'The panel of the New theme form in Settings.',
  'card-foreground': 'Text on a card: the New theme form.',
  popover:
    'The surface of anything that floats: menus, dropdowns, the command palette, the color picker, dialogs, toasts and the label that follows a dragged tab.',
  'popover-foreground':
    'Text on floating surfaces: menu items, dialog text, the palette and toasts.',
  primary:
    'The brand color: default buttons, a switch that is on, the chosen option of a toggle, Settings headings, the unsaved-changes dot, the top line of the active tab in the focused pane, task checkboxes and the tab drop bar.',
  'primary-foreground':
    'Text and icons on the primary color: the label of a default button and of the chosen option in a toggle.',
  secondary:
    'The fill of secondary buttons. No screen of the app has one yet; only the Theme preview shows it.',
  'secondary-foreground':
    'Text on secondary buttons. No screen of the app has one yet; only the Theme preview shows it.',
  muted:
    'A quiet surface: notices above a pane, the find bar, notices and chips in Settings, markdown table headers, the front matter pill, the strip at the foot of a dialog, and the checkerboard behind a translucent color.',
  'muted-foreground':
    'Secondary text: descriptions, hints, keyboard shortcuts, and text on a muted surface.',
  accent:
    'The fill of whatever you point at, focus or open: a hovered button or menu item, the current Settings category, the highlighted item in a list.',
  'accent-foreground':
    'Text and icons on the accent color: what a hovered button or a highlighted menu item shows.',
  destructive:
    'Errors and dangerous actions: error text, an invalid field border, the red delete and reset buttons, and the fill of the close-window button on hover and of the file name error bubble.',
  'destructive-foreground':
    'Text on a solid destructive fill: the close-window button when you point at it, and the red bubble that says a file name is not allowed, for example because it already exists.',
  warning:
    'A hint that is not an error: contrast warnings under a color here, and the note that a keyboard shortcut is already taken.',
  success: 'Good news: the "In use" badge on the theme that is in use.',
  border:
    'Lines: borders of panels and fields, separators in menus, table and code block outlines, and the horizontal rule in a document.',
  input: 'Borders and fill of text fields and selects, and a switch that is off.',
  ring: 'The focus ring: the outline around the button, field or control that has keyboard focus, and around the folder a file is dropped onto.',
  tooltip: 'The surface of hover hints, like this one.',
  'tooltip-foreground': 'Text on hover hints, like this one.',

  // Sidebar
  sidebar: 'The background of the sidebar (Folders, Search and Outline).',
  'sidebar-foreground': 'Text in the sidebar: file names, results and panel text.',
  'sidebar-accent':
    'The highlight of a row in the sidebar: the selected file, a hovered row, and the folder you are dragging onto.',
  'sidebar-accent-foreground': 'Text on a highlighted sidebar row.',
  'sidebar-border': 'The lines inside the sidebar and the edge between it and the editor.',
  'git-added':
    'Names in the file tree that git has been told about but not yet committed: files and folders that are staged as new.',
  'git-untracked':
    'Names in the file tree that git does not know yet: new files and folders that are not staged.',
  'git-conflicted': 'Names in the file tree that git sees in conflict after a merge or rebase.',
  'git-modified':
    'Names in the file tree that git sees as changed or renamed, and folders that hold a change.',
  'git-ignored':
    'Names in the file tree that a .gitignore hides from git, and everything inside an ignored folder.',

  // Chrome
  titlebar: 'The title bar at the top of the window.',
  'titlebar-foreground':
    'Text and icons in the title bar: the menu button, the window title, and the minimize, maximize and close buttons.',
  tabstrip:
    'The background of the strip that holds the tabs, which the tabs that are not active share. In the light themes it is darker than the page, so the active tab stands out.',
  'tab-foreground': 'Text of the tabs that are not active, and of the buttons in the strip.',
  'tab-active': 'The background of the active tab.',
  'tab-active-foreground': 'Text of the active tab.',
  'tab-separator':
    'The thin line between two tabs that are not active. It hides next to the tab you point at.',
  statusbar: 'The bar at the bottom of the window.',
  'statusbar-foreground': 'Text in the status bar.',
  handle:
    'The draggable dividers between panes and the edge of the sidebar, while nothing is pointing at them.',
  'handle-active':
    'The same dividers and sidebar edge while you point at or drag them, and the outline and corner handle of a selected image.',
  'scrollbar-thumb': 'The scrollbar thumb. It can be translucent.',
  'scrollbar-thumb-hover': 'The scrollbar thumb while the pointer is over it.',
  'drop-preview':
    'The tint over the pane where a dragged tab will land. It shows only while you drag a tab.',

  // Editor
  selection: 'The highlight behind selected text in the editor.',
  'find-match':
    'Matches of the Find bar and of a folder search: highlighted in the editor, and in the results list of the Search panel.',
  'find-match-active':
    'The match you are on in the Find bar, the marks along the scrollbar that show where the matches are, and the match a folder search result jumps to.',
  caret: 'The text cursor in the editor.',
  gutter:
    'The strip behind the line numbers, beside the text. It starts as the page color, so there is no box. It shows only while line numbers are on.',
  'gutter-foreground':
    'The line numbers. The number of the line with the cursor uses the main text color instead.',
  'table-stripe':
    'The fill of every second body row of a table in a document. The Striped table rows setting turns it off.',
  'checkbox-background':
    'The inside of an unchecked task checkbox in a document. A checked one is filled with the primary color.',

  // Syntax
  'syntax-heading': 'Markdown headings in the editor.',
  'syntax-link': 'Links in the editor.',
  'syntax-code': 'The text of inline code.',
  'syntax-code-background': 'The background behind inline code and code blocks.',
  'syntax-code-border': 'The thin outline around inline code and code blocks.',
  'syntax-quote': 'Block quotes.',
  'syntax-marker':
    'Markdown marks such as the # of a heading, list bullets and the > of a quote, which stay dim.',
  'syntax-keyword': 'Keywords in code blocks, such as if, return and class.',
  'syntax-string': 'Strings in code blocks.',
  'syntax-number': 'Numbers in code blocks.',
  'syntax-comment': 'Comments in code blocks, and in JSON files such as settings.json.',
  'syntax-function': 'Function names in code blocks.',
  'syntax-type': 'Type and class names in code blocks.',
  'syntax-punctuation': 'Brackets, commas and operators in code blocks.',
  'syntax-invalid': 'Code that does not parse in a code block, such as a broken string.',
}

/** The sentence for a token, or an empty string for a name that has none (the hint then stays off). */
export function usageOf(token: string): string {
  return THEME_TOKEN_USAGE[token] ?? ''
}
