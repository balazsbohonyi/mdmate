import { describe, expect, it } from 'vitest'
import { fuzzyMatch, rankByFuzzy } from '@/lib/fuzzy'

/** The paths in best-first order for a query, the way the file picker would rank them. */
function ranked(query: string, paths: readonly string[]): string[] {
  return rankByFuzzy(
    paths,
    query,
    (path) => path,
    (path) => path.lastIndexOf('/') + 1,
  ).map(({ item }) => item)
}

describe('which texts match', () => {
  it('needs every letter, in order', () => {
    expect(fuzzyMatch('plan', 'plan.md')).not.toBeNull()
    expect(fuzzyMatch('plan', 'explain.md')).not.toBeNull()
    expect(fuzzyMatch('plan', 'pla.md')).toBeNull()
    expect(fuzzyMatch('plan', 'nalp.md')).toBeNull()
  })

  it('ignores case and the spaces in the query', () => {
    expect(fuzzyMatch('MEETING', 'meeting-notes.md')).not.toBeNull()
    expect(fuzzyMatch('meeting notes', 'Meeting-Notes.md')).not.toBeNull()
    expect(fuzzyMatch('  m n ', 'Meeting-Notes.md')).not.toBeNull()
  })

  it('matches nothing for an empty query or one longer than the text', () => {
    expect(fuzzyMatch('', 'a.md')).toBeNull()
    expect(fuzzyMatch('   ', 'a.md')).toBeNull()
    expect(fuzzyMatch('abcdefgh', 'a.md')).toBeNull()
  })
})

describe('which match is better', () => {
  it('puts the start of a name before the middle of one', () => {
    const order = ranked('not', ['a/denote.md', 'a/note.md', 'not.md', 'a/b/anote.md'])
    expect(order.slice(0, 2)).toEqual(['not.md', 'a/note.md'])
  })

  it('puts a run of letters before scattered ones, and word starts before plain gaps', () => {
    expect(ranked('abc', ['axbxc.md', 'a-b-c.md', 'abc.md'])).toEqual([
      'abc.md',
      'a-b-c.md',
      'axbxc.md',
    ])
  })

  it('puts a match in the name before the same match in a folder', () => {
    expect(ranked('foo', ['foo/bar.md', 'bar/foo.md'])).toEqual(['bar/foo.md', 'foo/bar.md'])
  })

  it('puts the start of a word before the middle of one', () => {
    expect(ranked('todo', ['xtodo.md', 'x-todo.md', 'xTodo.md']).at(-1)).toBe('xtodo.md')
  })

  it('lets a query reach into the folder as well as the name', () => {
    expect(ranked('notes/pla', ['notes/plan.md', 'notes/idea.md', 'plan/notes.md'])[0]).toBe(
      'notes/plan.md',
    )
  })

  it('puts a shorter text first among equals', () => {
    expect(ranked('a', ['a.md', 'a-longer-name.md', 'a-b.md'])[0]).toBe('a.md')
  })
})

describe('what each point of the score is for', () => {
  const score = (query: string, text: string, nameStart = 0): number =>
    fuzzyMatch(query, text, nameStart)?.score ?? Number.NEGATIVE_INFINITY

  it('takes points off for each letter before the first match, up to a limit', () => {
    expect(score('note', 'mnote-aaaaaaaaaaaaaaaaaaaa.md')).toBeGreaterThan(
      score('note', 'mmmmmmmmmmnote-aaa.md'),
    )
  })

  it('puts the first letter of a name after a slash before the middle of a word', () => {
    // The middle-of-a-word match is nearer the start, so only the word-start bonus tells them apart.
    expect(score('n', 'abc/n.md', 4)).toBeGreaterThan(score('n', 'abn.md', 0))
  })

  it('prefers the case that was typed', () => {
    expect(score('Plan', 'Plan.md')).toBeGreaterThan(score('Plan', 'plan.md'))
    expect(score('plan', 'plan.md')).toBeGreaterThan(score('plan', 'Plan.md'))
  })

  it('only counts the first sixty-four letters of a query', () => {
    const name = `${'a'.repeat(64)}.md`
    expect(fuzzyMatch(`${'a'.repeat(64)}zzzzzz`, name)).not.toBeNull()
  })
})

describe('where the letters matched', () => {
  it('names each matched letter as an offset into the text', () => {
    expect(fuzzyMatch('pl', 'docs/plan.md', 5)?.matches).toEqual([5, 6])
  })

  it('counts UTF-16 units, not letters', () => {
    // The smiley is one letter and two UTF-16 units; the offsets must skip both.
    expect(fuzzyMatch('日本', '😀/日本.md', 3)?.matches).toEqual([3, 4])
  })
})
