/**
 * Fuzzy matching: a few typed letters against a name or a path. The command palette ranks its
 * titles with this, and so does the browser stand-in for the file index. The real file index is in
 * Rust (`workspace/quick.rs`) and uses the same points; the two are tested separately.
 *
 * Letters must appear in order. Spaces in the query are ignored and case does not matter. Among the
 * ways the letters can be placed, the best is chosen: a run of letters beats scattered ones, the
 * start of a word beats the middle of one, and a letter in a file's own name (after the last `/`)
 * beats one in a folder.
 */
export interface FuzzyHit {
  readonly score: number
  /** The letters of the text that matched, as UTF-16 offsets. */
  readonly matches: readonly number[]
}

const BASE = 16
const RUN = 18
const GAP = 3
const LEADING_GAP = 1
const LEADING_GAP_MAX = 12
const IN_NAME = 8
const EXACT_CASE = 2
const AFTER_SLASH = 24
const AFTER_SEPARATOR = 20
const CAMEL = 16
const NONE = -1_000_000_000
const MAX_QUERY = 64

function fold(letter: string): string {
  return Array.from(letter.toLowerCase())[0] ?? letter
}

const isLower = (letter: string): boolean =>
  letter === letter.toLowerCase() && letter !== letter.toUpperCase()
const isUpper = (letter: string): boolean =>
  letter === letter.toUpperCase() && letter !== letter.toLowerCase()

/** The bonus for matching the letter at `at`, from what comes before it. */
function boundary(text: readonly string[], at: number): number {
  const before = text[at - 1]
  if (before === undefined) return AFTER_SLASH
  if (before === '/') return AFTER_SLASH
  if (before === '-' || before === '_' || before === ' ' || before === '.') return AFTER_SEPARATOR
  const here = text[at]
  if (here !== undefined && isLower(before) && isUpper(here)) return CAMEL
  return 0
}

/**
 * Matches `query` against `text`. `nameStart` is where the file's own name begins, as a UTF-16
 * offset (0 for something that is only a name, such as a command title). Null when the letters are
 * not all there in order.
 */
export function fuzzyMatch(query: string, text: string, nameStart = 0): FuzzyHit | null {
  const typed = Array.from(query)
    .filter((letter) => letter.trim() !== '')
    .slice(0, MAX_QUERY)
  const wanted = typed.map(fold)
  const letters = Array.from(text)
  const hay = letters.map(fold)
  const m = wanted.length
  const n = hay.length
  if (m === 0 || m > n) return null

  // Where each letter starts, in UTF-16 units, with the total as a last entry.
  const offsets: number[] = []
  let units = 0
  for (const letter of letters) {
    offsets.push(units)
    units += letter.length
  }
  offsets.push(units)
  let nameAt = offsets.findIndex((offset) => offset >= nameStart)
  if (nameAt < 0) nameAt = n

  let next = 0
  for (const letter of hay) {
    if (next < m && letter === wanted[next]) next++
  }
  if (next < m) return null

  const score = new Int32Array(m * n).fill(NONE)
  const from = new Int32Array(m * n).fill(-1)
  for (let i = 0; i < m; i++) {
    // The best earlier placement of letter i-1 at k <= j-2, with GAP paid for each letter skipped:
    // score[k] - GAP*(j-k-1) = (score[k] + GAP*k) - GAP*(j-1), so one running best is enough.
    let spaced = NONE
    let spacedAt = -1
    for (let j = i; j < n; j++) {
      if (i > 0 && j >= 2) {
        const k = j - 2
        const earlier = score[(i - 1) * n + k] ?? NONE
        if (earlier > NONE && earlier + GAP * k > spaced) {
          spaced = earlier + GAP * k
          spacedAt = k
        }
      }
      if (hay[j] !== wanted[i]) continue
      let here = BASE + boundary(letters, j)
      if (j >= nameAt) here += IN_NAME
      if (letters[j] === typed[i]) here += EXACT_CASE
      let fromScore: number
      let fromAt = -1
      if (i === 0) {
        fromScore = -(LEADING_GAP * Math.min(j, LEADING_GAP_MAX))
      } else {
        fromScore = spaced > NONE ? spaced - GAP * (j - 1) : NONE
        fromAt = spacedAt
        const adjacent = j >= 1 ? (score[(i - 1) * n + (j - 1)] ?? NONE) : NONE
        if (adjacent > NONE && adjacent + RUN >= fromScore) {
          fromScore = adjacent + RUN
          fromAt = j - 1
        }
      }
      if (fromScore <= NONE) continue
      score[i * n + j] = fromScore + here
      from[i * n + j] = fromAt
    }
  }

  const last = (m - 1) * n
  let end = -1
  let best = NONE
  for (let j = 0; j < n; j++) {
    const value = score[last + j] ?? NONE
    if (value > best) {
      best = value
      end = j
    }
  }
  if (end < 0) return null
  const at: number[] = new Array<number>(m).fill(0)
  let j = end
  for (let i = m - 1; i >= 0; i--) {
    at[i] = offsets[j] ?? 0
    if (i > 0) j = from[i * n + j] ?? 0
  }
  return { score: best, matches: at }
}

/** The items that match, best first: higher score, then shorter text, then alphabetical. */
export function rankByFuzzy<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
  nameStartOf: (item: T) => number = () => 0,
): { item: T; hit: FuzzyHit }[] {
  const found: { item: T; hit: FuzzyHit; text: string }[] = []
  for (const item of items) {
    const text = textOf(item)
    const hit = fuzzyMatch(query, text, nameStartOf(item))
    if (hit !== null) found.push({ item, hit, text })
  }
  found.sort(
    (a, b) =>
      b.hit.score - a.hit.score ||
      a.text.length - b.text.length ||
      (a.text.toLowerCase() < b.text.toLowerCase()
        ? -1
        : a.text.toLowerCase() > b.text.toLowerCase()
          ? 1
          : 0),
  )
  return found.map(({ item, hit }) => ({ item, hit }))
}
