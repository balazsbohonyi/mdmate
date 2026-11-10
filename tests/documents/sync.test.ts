import { Transaction } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { Document } from '@/documents/document'
import type { Follower } from '@/documents/follower'
import { uniformEndings } from '@/lib/endings'
import type { OpenedFile } from '@/platform'

/** A document with no host behind it: the master and its followers, all headless. */
function open(text = 'hello world\n', changed: (doc: Document) => void = () => undefined) {
  const opened: OpenedFile = {
    id: 1,
    path: '/t/a.md',
    name: 'a.md',
    encoding: 'utf-8',
    bom: false,
    readOnly: null,
    size: text.length,
    hash: '0'.repeat(32),
    kind: 'markdown',
    text,
    endings: uniformEndings(),
  }
  return new Document(opened, changed)
}

const text = (follower: Follower) => follower.state.doc.toString()

/** Each edit is a separate undo step: far enough apart in time that history will not group them. */
let clock = 1_000_000
function type(follower: Follower, from: number, insert: string, to = from): void {
  clock += 10_000
  follower.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: 'input.type',
    annotations: Transaction.time.of(clock),
  })
}

describe('a document with two followers (ISC-41)', () => {
  it('shows an edit made in one follower in the other, and in the master', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    type(a, 5, ' big')
    expect(text(a)).toBe('hello big world\n')
    expect(text(b)).toBe('hello big world\n')
    expect(doc.master.doc.toString()).toBe('hello big world\n')
    type(b, 0, '>> ')
    expect(text(a)).toBe('>> hello big world\n')
    expect(text(b)).toBe('>> hello big world\n')
    expect(doc.master.doc.toString()).toBe('>> hello big world\n')
  })

  it('moves the other follower caret along with the text', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    b.dispatch({ selection: { anchor: 8 } }) // inside "world"
    type(a, 0, 'XX')
    expect(b.state.selection.main.head).toBe(10)
    type(a, 12, 'YY') // after the caret: it stays
    expect(b.state.selection.main.head).toBe(10)
  })

  it('catches a follower up on everything it missed, as one change, when it is next read', () => {
    const doc = open('0123456789\n')
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    const update = vi.spyOn(b.state, 'update')
    for (let i = 0; i < 20; i++) type(a, 0, String(i % 10))
    // Nothing was applied to b yet: it only noted the changes. Reading it applies them together.
    expect(update).not.toHaveBeenCalled()
    expect(text(b)).toBe(doc.master.doc.toString())
    expect(update).toHaveBeenCalledTimes(1)
    expect(text(b)).toBe(text(a))
  })

  it('gives a follower made later the current text and caret', () => {
    const doc = open()
    const a = doc.followerFor('a')
    type(a, 5, '!')
    const late = doc.followerFor('late')
    expect(text(late)).toBe('hello! world\n')
    expect(late.state.selection.main.head).toBe(6)
  })

  it('keeps every follower the same after any mix of edits and undos', () => {
    // A small seeded generator, so a failure can be replayed.
    let seed = 12345
    const next = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % n
    }
    for (let run = 0; run < 150; run++) {
      const original = 'alpha\nbeta\ngamma\n'
      const doc = open(original)
      const followers: Follower[] = [doc.followerFor('f0')]
      let made = 1
      const same = () => {
        const expected = doc.master.doc.toString()
        for (const f of followers) expect(text(f)).toBe(expected)
      }
      for (let step = 0; step < 40; step++) {
        const f = followers[next(followers.length)]
        if (f === undefined) throw new Error('no follower')
        const length = f.state.doc.length
        switch (next(8)) {
          case 0:
          case 1:
          case 2:
            type(f, next(length + 1), ['x', 'yz', '\n', ' '][next(4)] ?? 'x')
            break
          case 3: {
            const from = next(length + 1)
            type(f, from, '', Math.min(length, from + 1 + next(4)))
            break
          }
          case 4:
            f.dispatch({ selection: { anchor: next(length + 1) } })
            break
          case 5:
            f.undo()
            break
          case 6:
            f.redo()
            break
          default:
            if (followers.length < 3) {
              followers.push(doc.followerFor(`f${made++}`))
            } else if (followers.length > 1) {
              const [gone] = followers.splice(next(followers.length), 1)
              if (gone) doc.closeFollower(gone.id)
            }
        }
        same()
      }
      // Redo to the top of the history, then undo everything: the file as it was opened. Redoing
      // everything again gives back the same text as the top.
      const first = followers[0]
      if (first === undefined) throw new Error('no follower')
      while (first.redo()) same()
      const top = doc.master.doc.toString()
      while (first.undo()) same()
      expect(doc.master.doc.toString()).toBe(original)
      while (first.redo()) same()
      expect(doc.master.doc.toString()).toBe(top)
    }
  })
})

describe('undo and redo (ISC-42)', () => {
  it('undoes, from the follower that did not make the edit, and redoes from either', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    type(a, 5, ' big')
    expect(b.undo()).toBe(true)
    expect(text(a)).toBe('hello world\n')
    expect(text(b)).toBe('hello world\n')
    expect(doc.master.doc.toString()).toBe('hello world\n')
    expect(a.redo()).toBe(true)
    expect(text(b)).toBe('hello big world\n')
    expect(text(a)).toBe('hello big world\n')
  })

  it('undoes edits from both followers in the order they were made', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    type(a, 0, 'A')
    type(b, 0, 'B')
    type(a, 0, 'C')
    expect(text(a)).toBe('CBAhello world\n')
    b.undo()
    expect(text(a)).toBe('BAhello world\n')
    a.undo()
    expect(text(b)).toBe('Ahello world\n')
    b.undo()
    expect(text(a)).toBe('hello world\n')
    expect(a.undo()).toBe(false)
    expect(b.undo()).toBe(false)
  })

  it('has nothing to undo or redo before any edit', () => {
    const a = open().followerFor('a')
    expect(a.undo()).toBe(false)
    expect(a.redo()).toBe(false)
  })

  it('undoes quick typing in one step, like a view with its own history', () => {
    const doc = open('')
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    const t = 5_000_000
    for (const [i, ch] of [...'abc'].entries()) {
      a.dispatch({
        changes: { from: i, insert: ch },
        selection: { anchor: i + 1 },
        userEvent: 'input.type',
        annotations: Transaction.time.of(t + i * 50),
      })
    }
    expect(text(b)).toBe('abc')
    b.undo()
    expect(text(a)).toBe('')
  })

  it('puts the caret where the undone edit was made, in the follower that asked', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    a.dispatch({ selection: { anchor: 3 } })
    type(a, 3, 'ZZ')
    b.dispatch({ selection: { anchor: 0 } })
    b.undo()
    expect(text(b)).toBe('hello world\n')
    expect(b.state.selection.main.head).toBe(3)
  })

  it('records the caret an edit was made from, even if another follower moved it since', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    a.dispatch({ selection: { anchor: 2 } })
    b.dispatch({ selection: { anchor: 9 } }) // the master now has b's caret
    type(a, 2, 'QQ')
    a.undo()
    expect(a.state.selection.main.head).toBe(2)
  })

  it('does not undo in a read-only document', () => {
    const opened: OpenedFile = {
      id: 2,
      path: '/t/ro.md',
      name: 'ro.md',
      encoding: 'unsupported',
      bom: false,
      readOnly: 'unsupported-encoding',
      size: 3,
      hash: '1'.repeat(32),
      kind: 'markdown',
      text: 'abc',
      endings: uniformEndings(),
    }
    const doc = new Document(opened, () => undefined)
    const a = doc.followerFor('a')
    expect(a.state.readOnly).toBe(true)
    expect(a.undo()).toBe(false)
  })
})

describe('closing a follower (ISC-43)', () => {
  it('keeps the undo history, so another follower can still undo what the closed one did', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    type(a, 0, 'one ')
    type(a, 4, 'two ')
    doc.closeFollower('a')
    expect(doc.followerCount).toBe(1)
    expect(b.undo()).toBe(true)
    expect(text(b)).toBe('one hello world\n')
    expect(b.undo()).toBe(true)
    expect(text(b)).toBe('hello world\n')
    expect(b.redo()).toBe(true)
    expect(text(b)).toBe('one hello world\n')
  })

  it('keeps it even when the last follower closes and a new one opens', () => {
    const doc = open()
    const a = doc.followerFor('a')
    type(a, 0, 'edit ')
    doc.closeFollower('a')
    expect(doc.followerCount).toBe(0)
    const again = doc.followerFor('again')
    expect(text(again)).toBe('edit hello world\n')
    expect(again.undo()).toBe(true)
    expect(text(again)).toBe('hello world\n')
  })

  it('stops sending changes to a closed follower', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    doc.closeFollower('b')
    type(a, 0, 'x')
    expect(text(b)).toBe('hello world\n') // b was closed before the edit, and stays as it was
    expect(text(doc.followerFor('c'))).toBe('xhello world\n')
  })
})

describe('whether the document is edited', () => {
  it('turns dirty on an edit in any follower and clean when it is undone back to the saved text', () => {
    const changes: boolean[] = []
    const doc = open('hello world\n', (d) => changes.push(d.dirty))
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    expect(doc.dirty).toBe(false)
    type(a, 0, 'x')
    expect(doc.dirty).toBe(true)
    b.undo()
    expect(doc.dirty).toBe(false)
    expect(changes).toEqual([true, false])
  })

  it('saves what the master holds, however the followers typed it', () => {
    const doc = open()
    const a = doc.followerFor('a')
    const b = doc.followerFor('b')
    type(a, 5, ',')
    type(b, 0, '# ')
    expect(doc.snapshot().text).toBe('# hello, world\n')
  })
})
