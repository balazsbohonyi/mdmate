import { openNewTab, resetWorkbench, splitActivePane } from './store'

/**
 * A layout with three levels of splits (row, column, row) and tabs to move around. Only
 * `pnpm dev` and `pnpm tauri dev` call it, behind `import.meta.env.DEV`, so a release build has
 * none of it and starts with one empty pane. It stands in until Phase 2 opens real files.
 */
export function seedDemoWorkbench(): void {
  resetWorkbench()
  openNewTab('README.md')
  openNewTab('notes.md')
  openNewTab('ideas.md')
  splitActivePane('row', 'roadmap.md')
  openNewTab('changelog.md')
  splitActivePane('column', 'todo.md')
  openNewTab('shopping.md')
  splitActivePane('row', 'draft.md')
  openNewTab('journal.md')
}
