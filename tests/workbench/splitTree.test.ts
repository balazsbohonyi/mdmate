import { describe, expect, it } from 'vitest'
import {
  activatePane,
  activateTab,
  allTabs,
  closePane,
  closeTab,
  createLayout,
  deserialize,
  depthOf,
  findPane,
  moveTab,
  moveTabToEdge,
  openTab,
  paneOfTab,
  panesOf,
  serialize,
  setSizes,
  splitPane,
  validateLayout,
  type Layout,
  type SplitBranch,
  type SplitNode,
} from '@/workbench/splitTree'

/** A layout with these tabs open in the first pane. */
function withTabs(...tabs: string[]): Layout {
  return tabs.reduce((layout, tab) => openTab(layout, tab), createLayout())
}

function expectValid(layout: Layout): void {
  expect(validateLayout(layout)).toEqual([])
}

function branch(node: SplitNode): SplitBranch {
  if (node.kind !== 'split') throw new Error('expected a split')
  return node
}

/** The shape of a tree without ids or sizes: panes as their tab lists, splits as `row[...]`. */
function shape(node: SplitNode): string {
  if (node.kind === 'pane') return `[${node.tabs.join(',')}]`
  return `${node.direction}(${node.children.map(shape).join(' ')})`
}

describe('a new layout', () => {
  it('is one empty pane', () => {
    const layout = createLayout()
    expect(shape(layout.root)).toBe('[]')
    expect(layout.activePane).toBe('p1')
    expectValid(layout)
  })
})

describe('split right (ISC-28)', () => {
  it('makes two panes side by side, sharing the space equally', () => {
    const layout = splitPane(withTabs('a'), 'p1', 'row', 'after', ['b'])
    const root = branch(layout.root)
    expect(root.direction).toBe('row')
    expect(shape(root)).toBe('row([a] [b])')
    expect(root.sizes).toEqual([50, 50])
    expectValid(layout)
  })

  it('makes the new pane the active one', () => {
    const layout = splitPane(withTabs('a'), 'p1', 'row', 'after', ['b'])
    expect(findPane(layout, layout.activePane)?.tabs).toEqual(['b'])
  })

  it('can put the new pane before the old one', () => {
    const layout = splitPane(withTabs('a'), 'p1', 'row', 'before', ['b'])
    expect(shape(layout.root)).toBe('row([b] [a])')
  })

  it('adds an empty pane when no tab is given', () => {
    const layout = splitPane(withTabs('a'), 'p1', 'row')
    expect(shape(layout.root)).toBe('row([a] [])')
    expectValid(layout)
  })

  it('adds to the row it is already in, taking half of the pane it splits', () => {
    const first = splitPane(withTabs('a'), 'p1', 'row', 'after', ['b'])
    const second = splitPane(first, 'p2', 'row', 'after', ['c'])
    expect(shape(second.root)).toBe('row([a] [b] [c])')
    expect(branch(second.root).sizes).toEqual([50, 25, 25])
    expectValid(second)
  })

  it('refuses a tab that is already open, and a pane that does not exist', () => {
    const layout = withTabs('a')
    expect(splitPane(layout, 'p1', 'row', 'after', ['a'])).toBe(layout)
    expect(splitPane(layout, 'nope', 'row')).toBe(layout)
  })
})

describe('split down (ISC-29)', () => {
  it('makes two stacked panes', () => {
    const layout = splitPane(withTabs('a'), 'p1', 'column', 'after', ['b'])
    expect(shape(layout.root)).toBe('column([a] [b])')
    expect(branch(layout.root).sizes).toEqual([50, 50])
    expectValid(layout)
  })

  it('nests a column inside a row when the pane is already in a row', () => {
    const row = splitPane(withTabs('a'), 'p1', 'row', 'after', ['b'])
    const layout = splitPane(row, 'p2', 'column', 'after', ['c'])
    expect(shape(layout.root)).toBe('row([a] column([b] [c]))')
    expectValid(layout)
  })
})

describe('nesting (ISC-30)', () => {
  /** row( column([a] row([c] [d])) [b] ): three levels of splits, each running a different way. */
  function threeLevels(): Layout {
    let layout = withTabs('a')
    layout = splitPane(layout, 'p1', 'row', 'after', ['b'])
    layout = splitPane(layout, 'p1', 'column', 'after', ['c'])
    const c = paneOfTab(layout, 'c')
    if (!c) throw new Error('c is missing')
    return splitPane(layout, c.id, 'row', 'after', ['d'])
  }

  it('builds three levels in mixed directions', () => {
    const layout = threeLevels()
    expect(shape(layout.root)).toBe('row(column([a] row([c] [d])) [b])')
    expect(depthOf(layout.root)).toBe(4)
    expectValid(layout)
  })

  it('keeps every pane reachable in reading order', () => {
    expect(panesOf(threeLevels()).flatMap((pane) => pane.tabs)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('never nests a split inside a split that runs the same way', () => {
    // A column split of a pane that sits in a column joins that column instead.
    const layout = splitPane(threeLevels(), 'p1', 'column', 'after', ['e'])
    expect(shape(layout.root)).toBe('row(column([a] [e] row([c] [d])) [b])')
    expectValid(layout)
  })
})

describe('closing (ISC-31)', () => {
  it('removes a pane when its last tab closes, and the sibling takes the space', () => {
    const layout = closeTab(splitPane(withTabs('a'), 'p1', 'row', 'after', ['b']), 'b')
    expect(shape(layout.root)).toBe('[a]')
    expect(layout.root.kind).toBe('pane')
    expectValid(layout)
  })

  it('collapses a split left with one child', () => {
    const row = splitPane(withTabs('a'), 'p1', 'row', 'after', ['b'])
    const nested = splitPane(row, 'p2', 'column', 'after', ['c'])
    expect(shape(closeTab(nested, 'c').root)).toBe('row([a] [b])')
  })

  it('merges a collapsed split into its parent when they run the same way', () => {
    let layout = withTabs('a')
    layout = splitPane(layout, 'p1', 'row', 'after', ['b'])
    layout = splitPane(layout, 'p2', 'column', 'after', ['c'])
    layout = splitPane(layout, paneOfTab(layout, 'c')?.id ?? '', 'row', 'after', ['d'])
    expect(shape(layout.root)).toBe('row([a] column([b] row([c] [d])))')

    const closed = closeTab(layout, 'b')
    expect(shape(closed.root)).toBe('row([a] [c] [d])')
    expect(branch(closed.root).sizes).toEqual([50, 25, 25])
    expectValid(closed)
  })

  it('gives the closed pane its space to the previous sibling, or the next one when it was first', () => {
    let layout = withTabs('a')
    layout = splitPane(layout, 'p1', 'row', 'after', ['b'])
    layout = splitPane(layout, 'p2', 'row', 'after', ['c'])
    layout = setSizes(layout, branch(layout.root).id, [20, 30, 50])

    expect(branch(closeTab(layout, 'b').root).sizes).toEqual([50, 50])
    expect(branch(closeTab(layout, 'a').root).sizes).toEqual([50, 50])
    expect(branch(closeTab(layout, 'c').root).sizes).toEqual([20, 80])
  })

  it('keeps the last pane, empty', () => {
    const layout = closeTab(withTabs('a'), 'a')
    expect(shape(layout.root)).toBe('[]')
    expect(panesOf(layout)).toHaveLength(1)
    expectValid(layout)
  })

  it('moves the active tab to a neighbour, preferring the one on the right', () => {
    const layout = activateTab(withTabs('a', 'b', 'c'), 'b')
    expect(findPane(closeTab(layout, 'b'), 'p1')?.activeTab).toBe('c')
    expect(findPane(closeTab(withTabs('a', 'b', 'c'), 'c'), 'p1')?.activeTab).toBe('b')
  })

  it('leaves the active tab alone when another tab closes', () => {
    const layout = activateTab(withTabs('a', 'b', 'c'), 'c')
    expect(findPane(closeTab(layout, 'a'), 'p1')?.activeTab).toBe('c')
  })

  it('moves the active pane to a neighbour when its pane closes', () => {
    const layout = splitPane(withTabs('a'), 'p1', 'row', 'after', ['b'])
    expect(layout.activePane).toBe('p2')
    const closed = closeTab(layout, 'b')
    expect(closed.activePane).toBe('p1')
  })

  it('ignores a tab that is not open', () => {
    const layout = withTabs('a')
    expect(closeTab(layout, 'nope')).toBe(layout)
  })

  it('closes an empty pane, and the last pane just empties', () => {
    const split = splitPane(withTabs('a'), 'p1', 'row')
    expect(shape(closePane(split, 'p2').root)).toBe('[a]')
    expect(shape(closePane(withTabs('a', 'b'), 'p1').root)).toBe('[]')
  })
})

describe('moving a tab between panes (ISC-32)', () => {
  const two = (): Layout => splitPane(withTabs('a', 'b'), 'p1', 'row', 'after', ['c'])

  it('moves it to the end of the other pane and makes it active there', () => {
    const layout = moveTab(two(), 'a', 'p2')
    expect(shape(layout.root)).toBe('row([b] [c,a])')
    expect(findPane(layout, 'p2')?.activeTab).toBe('a')
    expect(layout.activePane).toBe('p2')
    expectValid(layout)
  })

  it('moves it to a chosen position', () => {
    expect(shape(moveTab(two(), 'a', 'p2', 0).root)).toBe('row([b] [a,c])')
  })

  it('closes the source pane when it is left empty', () => {
    const layout = moveTab(two(), 'c', 'p1')
    expect(shape(layout.root)).toBe('[a,b,c]')
    expectValid(layout)
  })

  it('picks a new active tab in the source pane', () => {
    const layout = activateTab(two(), 'a')
    expect(findPane(moveTab(layout, 'a', 'p2'), 'p1')?.activeTab).toBe('b')
  })
})

describe('reordering within a strip (ISC-176)', () => {
  it('puts the tab at the new position', () => {
    expect(findPane(moveTab(withTabs('a', 'b', 'c'), 'a', 'p1', 2), 'p1')?.tabs).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(findPane(moveTab(withTabs('a', 'b', 'c'), 'c', 'p1', 0), 'p1')?.tabs).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('clamps a position past either end', () => {
    expect(findPane(moveTab(withTabs('a', 'b', 'c'), 'a', 'p1', 99), 'p1')?.tabs).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(findPane(moveTab(withTabs('a', 'b', 'c'), 'c', 'p1', -5), 'p1')?.tabs).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('makes the moved tab active and changes no other pane', () => {
    const layout = moveTab(withTabs('a', 'b', 'c'), 'a', 'p1', 1)
    expect(findPane(layout, 'p1')?.activeTab).toBe('a')
    expectValid(layout)
  })
})

describe('moving a tab to a pane edge (ISC-33)', () => {
  const edges = [
    ['left', 'row([x] [a,b])'],
    ['right', 'row([a,b] [x])'],
    ['top', 'column([x] [a,b])'],
    ['bottom', 'column([a,b] [x])'],
  ] as const

  it.each(edges)('splits the pane at its %s edge', (edge, expected) => {
    const layout = moveTabToEdge(
      splitPane(withTabs('a', 'b'), 'p1', 'row', 'after', ['x']),
      'x',
      'p1',
      edge,
    )
    expect(shape(layout.root)).toBe(expected)
    expect(layout.activePane).toBe(paneOfTab(layout, 'x')?.id)
    expectValid(layout)
  })

  it('splits a pane off itself when it has other tabs', () => {
    const layout = moveTabToEdge(withTabs('a', 'b'), 'a', 'p1', 'right')
    expect(shape(layout.root)).toBe('row([b] [a])')
    expectValid(layout)
  })

  it('does nothing for the only tab of a pane dropped on its own edge', () => {
    const layout = withTabs('a')
    expect(moveTabToEdge(layout, 'a', 'p1', 'left')).toBe(layout)
  })

  it('closes the source pane when the move empties it, even next to the target', () => {
    const layout = splitPane(withTabs('a'), 'p1', 'row', 'after', ['b'])
    expect(shape(moveTabToEdge(layout, 'b', 'p1', 'bottom').root)).toBe('column([a] [b])')
    expectValid(moveTabToEdge(layout, 'b', 'p1', 'bottom'))
  })

  it('joins the row it is dropped into', () => {
    let layout = splitPane(withTabs('a', 'b'), 'p1', 'row', 'after', ['c'])
    layout = moveTabToEdge(layout, 'b', 'p1', 'right')
    expect(shape(layout.root)).toBe('row([a] [b] [c])')
    expect(branch(layout.root).sizes).toEqual([25, 25, 50])
    expectValid(layout)
  })
})

describe('resizing', () => {
  const layout = (): Layout => splitPane(withTabs('a'), 'p1', 'row', 'after', ['b'])

  it('sets the sizes of a split', () => {
    const start = layout()
    const next = setSizes(start, branch(start.root).id, [30, 70])
    expect(branch(next.root).sizes).toEqual([30, 70])
  })

  it('scales sizes that do not add up to 100', () => {
    const start = layout()
    const next = setSizes(start, branch(start.root).id, [1, 3])
    expect(branch(next.root).sizes).toEqual([25, 75])
    expectValid(next)
  })

  it('ignores a wrong count, a size of zero, a negative or non-finite size, and an unknown split', () => {
    const start = layout()
    const id = branch(start.root).id
    expect(setSizes(start, id, [100])).toEqual(start)
    expect(setSizes(start, id, [0, 100])).toBe(start)
    expect(setSizes(start, id, [-10, 110])).toBe(start)
    expect(setSizes(start, id, [Number.NaN, 50])).toBe(start)
    expect(setSizes(start, 'nope', [30, 70])).toBe(start)
  })

  it('resizes a nested split without touching the others', () => {
    const start = splitPane(layout(), 'p2', 'column', 'after', ['c'])
    const inner = branch(branch(start.root).children[1] ?? start.root)
    const next = setSizes(start, inner.id, [80, 20])
    expect(branch(next.root).sizes).toEqual([50, 50])
    expect(branch(branch(next.root).children[1] ?? next.root).sizes).toEqual([80, 20])
  })
})

describe('active tab and pane', () => {
  it('activates a tab and the pane that holds it', () => {
    const layout = splitPane(withTabs('a', 'b'), 'p1', 'row', 'after', ['c'])
    const next = activateTab(layout, 'a')
    expect(findPane(next, 'p1')?.activeTab).toBe('a')
    expect(next.activePane).toBe('p1')
  })

  it('opens a tab that is already open by activating it', () => {
    const layout = splitPane(withTabs('a', 'b'), 'p1', 'row', 'after', ['c'])
    const next = openTab(layout, 'a', 'p2')
    expect(paneOfTab(next, 'a')?.id).toBe('p1')
    expect(allTabs(next)).toEqual(['a', 'b', 'c'])
  })

  it('ignores an unknown pane', () => {
    const layout = withTabs('a')
    expect(activatePane(layout, 'nope')).toBe(layout)
    expect(openTab(layout, 'b', 'nope')).toBe(layout)
  })
})

describe('saving and loading', () => {
  function sample(): Layout {
    let layout = withTabs('a', 'b')
    layout = splitPane(layout, 'p1', 'row', 'after', ['c'])
    layout = splitPane(layout, 'p2', 'column', 'before', ['d'])
    return setSizes(layout, branch(layout.root).id, [35, 65])
  }

  it('round-trips a layout exactly', () => {
    const layout = sample()
    const loaded = deserialize(serialize(layout))
    expect(loaded).toEqual({ ok: true, layout })
  })

  it('round-trips an empty layout', () => {
    expect(deserialize(serialize(createLayout()))).toEqual({ ok: true, layout: createLayout() })
  })

  const broken: [string, (value: Record<string, unknown>) => unknown][] = [
    ['text that is not JSON', () => 'not json'],
    ['a layout that is not an object', () => []],
    [
      'a missing root',
      (value) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'root')),
    ],
    ['an unknown node kind', (value) => ({ ...value, root: { kind: 'tab', id: 'x' } })],
    [
      'a split with one child',
      (value) => ({
        ...value,
        root: {
          kind: 'split',
          id: 's9',
          direction: 'row',
          sizes: [100],
          children: [{ kind: 'pane', id: 'p1', tabs: [], activeTab: null }],
        },
      }),
    ],
    ['a missing active pane', (value) => ({ ...value, activePane: 'p99' })],
    ['a non-numeric nextId', (value) => ({ ...value, nextId: 'two' })],
  ]

  it.each(broken)('rejects %s', (_name, damage) => {
    const base = JSON.parse(serialize(sample())) as Record<string, unknown>
    const damaged = damage(base)
    const result = deserialize(typeof damaged === 'string' ? damaged : JSON.stringify(damaged))
    expect(result.ok).toBe(false)
  })

  it('rejects sizes that do not add up, a tab in two panes and a repeated id', () => {
    const base = sample()
    const root = branch(base.root)
    const badSizes = { ...base, root: { ...root, sizes: [10, 10] } }
    expect(deserialize(JSON.stringify(badSizes)).ok).toBe(false)

    const firstPane = root.children[0]
    if (firstPane?.kind !== 'pane') throw new Error('expected a pane first')
    const twoPlaces = {
      ...base,
      root: {
        ...root,
        children: [{ ...firstPane, tabs: ['c', ...firstPane.tabs] }, ...root.children.slice(1)],
      },
    }
    expect(deserialize(JSON.stringify(twoPlaces)).ok).toBe(false)

    const repeatedId = { ...base, root: { ...root, id: firstPane.id } }
    expect(deserialize(JSON.stringify(repeatedId)).ok).toBe(false)
  })
})

/** A small seeded generator, so a failing sequence can be replayed from its number. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('random sequences of operations', () => {
  it('always leave a valid layout that holds exactly the tabs that should be open, and round-trips', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const random = mulberry32(seed)
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
      let layout = createLayout()
      const expected = new Set<string>()
      let counter = 0
      const log: string[] = []

      for (let step = 0; step < 60; step++) {
        const panes = panesOf(layout)
        const tabs = allTabs(layout)
        const op = Math.floor(random() * 9)
        const newTab = `t${++counter}`
        if (op === 0) {
          layout = openTab(layout, newTab, pick(panes).id)
          expected.add(newTab)
          log.push(`open ${newTab}`)
        } else if (op === 1 && tabs.length > 0) {
          const tab = pick(tabs)
          layout = closeTab(layout, tab)
          expected.delete(tab)
          log.push(`close ${tab}`)
        } else if (op === 2 && tabs.length > 0) {
          layout = moveTab(layout, pick(tabs), pick(panes).id, Math.floor(random() * 6) - 1)
          log.push('moveTab')
        } else if (op === 3 && tabs.length > 0) {
          layout = moveTabToEdge(
            layout,
            pick(tabs),
            pick(panes).id,
            pick(['left', 'right', 'top', 'bottom'] as const),
          )
          log.push('moveTabToEdge')
        } else if (op === 4) {
          const withTab = random() < 0.6
          layout = splitPane(
            layout,
            pick(panes).id,
            pick(['row', 'column'] as const),
            pick(['before', 'after'] as const),
            withTab ? [newTab] : [],
          )
          if (withTab) expected.add(newTab)
          log.push('splitPane')
        } else if (op === 5) {
          const pane = pick(panes)
          for (const tab of pane.tabs) expected.delete(tab)
          layout = closePane(layout, pane.id)
          log.push(`closePane ${pane.id}`)
        } else if (op === 6 && layout.root.kind === 'split') {
          const splits: SplitBranch[] = []
          const collect = (node: SplitNode): void => {
            if (node.kind === 'split') {
              splits.push(node)
              node.children.forEach(collect)
            }
          }
          collect(layout.root)
          const split = pick(splits)
          layout = setSizes(
            layout,
            split.id,
            split.children.map(() => 1 + random() * 9),
          )
          log.push('setSizes')
        } else if (op === 7 && tabs.length > 0) {
          layout = activateTab(layout, pick(tabs))
          log.push('activateTab')
        } else {
          layout = activatePane(layout, pick(panes).id)
          log.push('activatePane')
        }

        const context = `seed ${seed}, step ${step}: ${log.slice(-3).join(' > ')}`
        expect(validateLayout(layout), context).toEqual([])
        expect(new Set(allTabs(layout)), context).toEqual(expected)
        expect(allTabs(layout), context).toHaveLength(expected.size)
      }

      expect(deserialize(serialize(layout)), `seed ${seed}`).toEqual({ ok: true, layout })
    }
  })
})
