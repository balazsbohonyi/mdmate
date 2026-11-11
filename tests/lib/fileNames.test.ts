/**
 * The name rules the tree shows while someone types (P6-T2). Rust checks every name again; these
 * are the same rules, so the message appears before anything is sent.
 */
import { describe, expect, it } from 'vitest'
import { freeName, isDeviceName, nameProblem } from '@/lib/fileNames'

describe('which names are refused', () => {
  it.each([
    '',
    '   ',
    '.',
    '..',
    'a/b',
    'a\\b',
    'a:b',
    'a<b',
    'a>b',
    'a"b',
    'a|b',
    'a?b',
    'a*b',
    'a.',
    'a ',
    'con',
    'NUL.txt',
    'com1.md',
    'lpt9',
    'tab\there',
    'x'.repeat(256),
  ])('refuses %j with a reason', (name) => {
    expect(nameProblem(name)).toEqual(expect.any(String))
  })

  it.each([
    'notes.md',
    '.gitignore',
    'a b.md',
    'résumé.md',
    'console.md',
    'v1.2',
    'a.b.c',
    'x'.repeat(255),
  ])('accepts %j', (name) => {
    expect(nameProblem(name)).toBeNull()
  })

  it('knows device names whatever their extension or case', () => {
    expect(isDeviceName('CON')).toBe(true)
    expect(isDeviceName('com3.tar.gz')).toBe(true)
    expect(isDeviceName('conn')).toBe(false)
    expect(isDeviceName('xcon')).toBe(false)
  })
})

describe('the name Keep both gives (ISC-199)', () => {
  const none = (): boolean => false

  it('puts the number before the extension of a file', () => {
    expect(freeName('notes.md', false, none)).toBe('notes (2).md')
    expect(freeName('a.tar.gz', false, none)).toBe('a.tar (2).gz')
  })

  it('counts up past names that are taken', () => {
    const taken = new Set(['notes (2).md', 'notes (3).md'])
    expect(freeName('notes.md', false, (name) => taken.has(name))).toBe('notes (4).md')
  })

  it('puts the number at the end of a folder or a dotfile', () => {
    expect(freeName('v1.2', true, none)).toBe('v1.2 (2)')
    expect(freeName('.env', false, none)).toBe('.env (2)')
    expect(freeName('trailing.', false, none)).toBe('trailing. (2)')
  })
})
