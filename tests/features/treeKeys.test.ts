import { describe, expect, it } from 'vitest'
import { isSelectable, keyAction, rowDomId, type TreeRow } from '@/features/tree/model'

/**
 * The keys of the sidebar tree as a pure function of the rows on screen (ISC-254): which row an
 * arrow lands on, what Right and Left do on a folder, and what Enter and Space do on a file.
 */

const folder = (path: string, depth: number, expanded: boolean): TreeRow => ({
  kind: depth === 0 ? 'root' : 'folder',
  root: '/w',
  path,
  name: path.split('/').at(-1) ?? path,
  depth,
  expanded,
})
const file = (path: string, depth: number): TreeRow => ({
  kind: 'file',
  root: '/w',
  path,
  name: path.split('/').at(-1) ?? path,
  depth,
  markdown: true,
})
const note = (path: string, depth: number): TreeRow => ({
  kind: 'note',
  root: '/w',
  path,
  name: 'Empty',
  depth,
  tone: 'muted',
})

// /w
//   notes (open)
//     a.md
//     deep (closed)
//   z.md
const ROWS: TreeRow[] = [
  folder('/w', 0, true),
  folder('/w/notes', 1, true),
  file('/w/notes/a.md', 2),
  folder('/w/notes/deep', 2, false),
  file('/w/z.md', 1),
]

describe('Up and Down move the selection and never open anything (ISC-254)', () => {
  it('Down goes to the next row, Up to the one before, and both stop at the ends', () => {
    expect(keyAction(ROWS, '/w/notes', 'ArrowDown')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/notes/a.md',
    })
    expect(keyAction(ROWS, '/w/notes/a.md', 'ArrowUp')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/notes',
    })
    expect(keyAction(ROWS, '/w/z.md', 'ArrowDown')).toBeNull()
    expect(keyAction(ROWS, '/w', 'ArrowUp')).toBeNull()
  })

  it('with nothing selected, either arrow starts at the first row', () => {
    expect(keyAction(ROWS, null, 'ArrowDown')).toEqual({ kind: 'select', root: '/w', path: '/w' })
    expect(keyAction(ROWS, null, 'ArrowUp')).toEqual({ kind: 'select', root: '/w', path: '/w' })
  })

  it('skips the notes and the new-name box, which cannot be selected', () => {
    const rows = [
      folder('/w', 0, true),
      folder('/w/empty', 1, true),
      note('/w/empty', 2),
      file('/w/z.md', 1),
    ]
    expect(keyAction(rows, '/w/empty', 'ArrowDown')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/z.md',
    })
    expect(keyAction(rows, '/w/z.md', 'ArrowUp')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/empty',
    })
    expect(rows.filter(isSelectable)).toHaveLength(3)
  })

  it('Home and End go to the first and last row', () => {
    expect(keyAction(ROWS, '/w/notes/a.md', 'Home')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w',
    })
    expect(keyAction(ROWS, '/w/notes/a.md', 'End')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/z.md',
    })
  })

  it('a selected row hidden in a closed folder counts as its nearest folder on screen', () => {
    const closed: TreeRow[] = [
      folder('/w', 0, true),
      folder('/w/notes', 1, false),
      file('/w/z.md', 1),
    ]
    expect(keyAction(closed, '/w/notes/a.md', 'ArrowDown')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/z.md',
    })
    expect(keyAction(closed, '/w/notes/deep/x.md', 'ArrowUp')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w',
    })
  })

  it('does nothing when there are no rows', () => {
    expect(keyAction([], null, 'ArrowDown')).toBeNull()
    expect(keyAction([note('/w', 0)], null, 'Home')).toBeNull()
  })
})

describe('Right and Left open, close and walk a folder (ISC-254)', () => {
  it('Right opens a closed folder, then steps into its first row', () => {
    expect(keyAction(ROWS, '/w/notes/deep', 'ArrowRight')).toEqual({
      kind: 'toggle',
      root: '/w',
      path: '/w/notes/deep',
    })
    expect(keyAction(ROWS, '/w/notes', 'ArrowRight')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/notes/a.md',
    })
  })

  it('Right does nothing on a file, or on an open folder with nothing in it but a note', () => {
    expect(keyAction(ROWS, '/w/z.md', 'ArrowRight')).toBeNull()
    const rows = [
      folder('/w', 0, true),
      folder('/w/e', 1, true),
      note('/w/e', 2),
      file('/w/z.md', 1),
    ]
    expect(keyAction(rows, '/w/e', 'ArrowRight')).toBeNull()
  })

  it('Left closes an open folder, then steps out to the folder that holds it', () => {
    expect(keyAction(ROWS, '/w/notes', 'ArrowLeft')).toEqual({
      kind: 'toggle',
      root: '/w',
      path: '/w/notes',
    })
    expect(keyAction(ROWS, '/w/notes/a.md', 'ArrowLeft')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/notes',
    })
    expect(keyAction(ROWS, '/w/notes/deep', 'ArrowLeft')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w/notes',
    })
    expect(keyAction(ROWS, '/w/z.md', 'ArrowLeft')).toEqual({
      kind: 'select',
      root: '/w',
      path: '/w',
    })
  })

  it('Left on a root that is closed or open has nowhere to step out to', () => {
    expect(keyAction(ROWS, '/w', 'ArrowLeft')).toEqual({ kind: 'toggle', root: '/w', path: '/w' })
    expect(keyAction([folder('/w', 0, false)], '/w', 'ArrowLeft')).toBeNull()
  })
})

describe('Enter and Space (ISC-254)', () => {
  it('toggle a folder, and open a file: Enter takes focus into it, Space keeps focus in the tree', () => {
    expect(keyAction(ROWS, '/w/notes', 'Enter')).toEqual({
      kind: 'toggle',
      root: '/w',
      path: '/w/notes',
    })
    expect(keyAction(ROWS, '/w/notes', ' ')).toEqual({
      kind: 'toggle',
      root: '/w',
      path: '/w/notes',
    })
    expect(keyAction(ROWS, '/w/z.md', 'Enter')).toEqual({
      kind: 'open',
      root: '/w',
      path: '/w/z.md',
      focusEditor: true,
    })
    expect(keyAction(ROWS, '/w/z.md', ' ')).toEqual({
      kind: 'open',
      root: '/w',
      path: '/w/z.md',
      focusEditor: false,
    })
  })

  it('do nothing when no row is selected, and other keys do nothing', () => {
    expect(keyAction(ROWS, null, 'Enter')).toBeNull()
    expect(keyAction(ROWS, null, ' ')).toBeNull()
    expect(keyAction(ROWS, '/w/z.md', 'a')).toBeNull()
  })
})

describe('row ids for aria-activedescendant', () => {
  it('hold no space or backslash, so one path gives one valid id', () => {
    const id = rowDomId(String.raw`C:\my notes\a b.md`)
    expect(id).toBe('tree-row-C%3A%5Cmy%20notes%5Ca%20b.md')
    expect(id).not.toMatch(/\s/)
    expect(rowDomId('/a')).not.toBe(rowDomId('/b'))
  })
})
