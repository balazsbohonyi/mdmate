/**
 * What Find in Folder puts in "files to include" (ISC-300), as VS Code writes it: the folder
 * relative to its root with `./`, the root's folder name first when several roots are open, and
 * the full path when two roots share a name.
 */
import { describe, expect, it } from 'vitest'
import { escapeGlob, includeForFolder, scopeText } from '@/features/search/folderFilter'

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

describe('includeForFolder', () => {
  it('with one root writes ./relative/path, and nothing for the root itself', () => {
    const roots = ['D:\\notes']
    expect(includeForFolder('D:\\notes\\analysis\\reports', 'D:\\notes', roots, same)).toBe(
      './analysis/reports',
    )
    expect(includeForFolder('D:\\notes\\analysis', 'D:\\notes', roots, same)).toBe('./analysis')
    expect(includeForFolder('D:\\notes', 'D:\\notes', roots, same)).toBe('')
    expect(includeForFolder('D:/notes/', 'D:/notes', roots, same)).toBe('')
  })

  it('with several roots puts the root folder name first, and a root row is just its name', () => {
    const roots = ['D:/dev/KnowledgeBase', 'D:/dev/projects']
    expect(
      includeForFolder(
        'D:/dev/KnowledgeBase/analysis/reports',
        'D:/dev/KnowledgeBase',
        roots,
        same,
      ),
    ).toBe('./KnowledgeBase/analysis/reports')
    expect(includeForFolder('D:/dev/KnowledgeBase', 'D:/dev/KnowledgeBase', roots, same)).toBe(
      './KnowledgeBase',
    )
  })

  it('under nested roots names the root the row sits under', () => {
    const roots = ['D:/dev/projects', 'D:/dev/projects/KnowledgeBase']
    expect(
      includeForFolder(
        'D:/dev/projects/KnowledgeBase/a',
        'D:/dev/projects/KnowledgeBase',
        roots,
        same,
      ),
    ).toBe('./KnowledgeBase/a')
    expect(
      includeForFolder('D:/dev/projects/KnowledgeBase/a', 'D:/dev/projects', roots, same),
    ).toBe('./projects/KnowledgeBase/a')
  })

  it('falls back to the whole path when two roots have the same folder name', () => {
    const roots = ['D:/one/docs', 'D:/two/docs']
    expect(includeForFolder('D:/one/docs/x', 'D:/one/docs', roots, same)).toBe('D:/one/docs/x')
    expect(includeForFolder('D:/two/docs', 'D:/two/docs', roots, same)).toBe('D:/two/docs')
  })

  it('writes the characters a pattern reads as wildcards so they match themselves', () => {
    expect(escapeGlob('a[1]*?{x}')).toBe('a[[]1[]][*][?][{]x[}]')
    expect(includeForFolder('/w/we[ird]', '/w', ['/w'], same)).toBe('./we[[]ird[]]')
  })
})

describe('scopeText', () => {
  it('names include and exclude as typed, trimmed, and is empty when both are', () => {
    expect(scopeText('', '')).toBe('')
    expect(scopeText('  ', ' ')).toBe('')
    expect(scopeText('./docs', '')).toBe('in ./docs')
    expect(scopeText('', '*.txt, **/build')).toBe('excluding *.txt, **/build')
    expect(scopeText(' ./docs ', '*.txt')).toBe('in ./docs, excluding *.txt')
  })
})
