import type { Text } from '@codemirror/state'

/**
 * Words and characters of a text, for the status bar. No word crosses a line break, so a text's
 * counts are the sum of its parts', and CodeMirror's text is a tree that keeps the parts an edit
 * does not touch (a selection cut from it too). The counts of each part are remembered, so after
 * the first time only what changed is read.
 */
export interface TextStats {
  /** Runs without white space that hold a letter or a digit. */
  readonly words: number
  /** Characters that take two units of the string, such as most emoji. */
  readonly wide: number
}

const known = new WeakMap<Text, TextStats>()

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

function read(text: string): TextStats {
  let words = 0
  for (const [run] of text.matchAll(/\S+/g)) if (LETTER_OR_DIGIT.test(run)) words += 1
  let wide = 0
  for (let at = 0; at < text.length; at++) {
    const unit = text.charCodeAt(at)
    if (unit >= 0xd800 && unit <= 0xdbff) wide += 1
  }
  return { words, wide }
}

/**
 * The counts of `text`, or null when reading it all would pass `budget.leaves` parts that are not
 * known yet. What was read is kept, so asking again goes on from there.
 */
export function textStats(text: Text, budget: { leaves: number }): TextStats | null {
  const found = known.get(text)
  if (found !== undefined) return found
  let stats: TextStats
  if (text.children === null) {
    if (budget.leaves <= 0) return null
    budget.leaves -= 1
    stats = read(text.sliceString(0))
  } else {
    let words = 0
    let wide = 0
    for (const child of text.children) {
      const part = textStats(child, budget)
      if (part === null) return null
      words += part.words
      wide += part.wide
    }
    stats = { words, wide }
  }
  known.set(text, stats)
  return stats
}
