/**
 * The workbench layout: a tree of panes and splits, with no framework and no document logic.
 * Every function takes a layout and returns a new one, so a Vue store, a test and a saved session
 * all share the same rules. A tab is only an id here; the documents arrive in Phase 2.
 *
 * Invariants, checked by `validateLayout` and held by every function below:
 * - a split has two or more children, and a child split never has its parent's direction;
 * - sizes are percentages: one per child, each above zero, summing to 100;
 * - every tab is in exactly one pane, and a pane's active tab is one of its tabs (null when empty);
 * - ids are unique, and the active pane exists.
 */

export type TabId = string
export type PaneId = string
export type SplitId = string
/** `row` lays children out side by side (split right), `column` stacks them (split down). */
export type Direction = 'row' | 'column'
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export type Placement = 'before' | 'after'

export interface PaneNode {
  readonly kind: 'pane'
  readonly id: PaneId
  readonly tabs: readonly TabId[]
  readonly activeTab: TabId | null
}

export interface SplitBranch {
  readonly kind: 'split'
  /** Split nodes carry an id so a view can key them and a resize can name the split it changes. */
  readonly id: SplitId
  readonly direction: Direction
  readonly children: readonly SplitNode[]
  readonly sizes: readonly number[]
}

export type SplitNode = PaneNode | SplitBranch

export interface Layout {
  readonly root: SplitNode
  readonly activePane: PaneId
  /** The next number to use in a pane or split id, so new ids are deterministic. */
  readonly nextId: number
}

const SIZE_TOLERANCE = 1e-6

// ---- reading -----------------------------------------------------------------------------

function leaves(node: SplitNode): PaneNode[] {
  return node.kind === 'pane' ? [node] : node.children.flatMap(leaves)
}

/** Every pane, left to right and top to bottom. */
export function panesOf(layout: Layout): readonly PaneNode[] {
  return leaves(layout.root)
}

export function findPane(layout: Layout, id: PaneId): PaneNode | undefined {
  return leaves(layout.root).find((pane) => pane.id === id)
}

export function paneOfTab(layout: Layout, tabId: TabId): PaneNode | undefined {
  return leaves(layout.root).find((pane) => pane.tabs.includes(tabId))
}

export function allTabs(layout: Layout): readonly TabId[] {
  return leaves(layout.root).flatMap((pane) => pane.tabs)
}

/** How many levels the tree has: a lone pane is 1, a split of panes is 2. */
export function depthOf(node: SplitNode): number {
  return node.kind === 'pane' ? 1 : 1 + Math.max(...node.children.map(depthOf))
}

// ---- building ----------------------------------------------------------------------------

/** One empty pane. */
export function createLayout(): Layout {
  return { root: emptyPane('p1'), activePane: 'p1', nextId: 2 }
}

function emptyPane(id: PaneId, tabs: readonly TabId[] = []): PaneNode {
  return { kind: 'pane', id, tabs, activeTab: tabs[0] ?? null }
}

function updatePane(node: SplitNode, id: PaneId, update: (pane: PaneNode) => PaneNode): SplitNode {
  if (node.kind === 'pane') return node.id === id ? update(node) : node
  let changed = false
  const children = node.children.map((child) => {
    const next = updatePane(child, id, update)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...node, children } : node
}

/** Takes a pane out of the tree. Its space goes to the previous sibling, or the next if it was first. */
function removePane(node: SplitNode, id: PaneId): SplitNode | null {
  if (node.kind === 'pane') return node.id === id ? null : node
  const children: SplitNode[] = []
  const sizes: number[] = []
  let carry = 0
  let changed = false
  node.children.forEach((child, index) => {
    const size = node.sizes[index] ?? 0
    const next = removePane(child, id)
    if (next === null) {
      changed = true
      const last = sizes.length - 1
      if (last >= 0) sizes[last] = (sizes[last] ?? 0) + size
      else carry += size
    } else {
      if (next !== child) changed = true
      children.push(next)
      sizes.push(size + carry)
      carry = 0
    }
  })
  if (!changed) return node
  if (children.length === 0) return null
  const only = children[0]
  if (children.length === 1 && only) return only
  return { ...node, children, sizes }
}

/** Merges a split into its parent when both run the same way, so the tree never nests a row in a row. */
function normalize(node: SplitNode): SplitNode {
  if (node.kind === 'pane') return node
  const children: SplitNode[] = []
  const sizes: number[] = []
  node.children.forEach((raw, index) => {
    const child = normalize(raw)
    const size = node.sizes[index] ?? 0
    if (child.kind === 'split' && child.direction === node.direction) {
      child.children.forEach((grandchild, at) => {
        children.push(grandchild)
        sizes.push((size * (child.sizes[at] ?? 0)) / 100)
      })
    } else {
      children.push(child)
      sizes.push(size)
    }
  })
  return { ...node, children, sizes }
}

/** Puts `added` next to the pane `targetId`, joining its row or column when the direction matches. */
function insertBeside(
  node: SplitNode,
  targetId: PaneId,
  added: PaneNode,
  direction: Direction,
  placement: Placement,
  splitId: SplitId,
): SplitNode {
  if (node.kind === 'pane') {
    if (node.id !== targetId) return node
    const pair = placement === 'before' ? [added, node] : [node, added]
    return { kind: 'split', id: splitId, direction, children: pair, sizes: [50, 50] }
  }
  const index = node.children.findIndex((child) => child.kind === 'pane' && child.id === targetId)
  const target = node.children[index]
  if (index >= 0 && target && node.direction === direction) {
    const half = (node.sizes[index] ?? 0) / 2
    const pair = placement === 'before' ? [added, target] : [target, added]
    return {
      ...node,
      children: [...node.children.slice(0, index), ...pair, ...node.children.slice(index + 1)],
      sizes: [...node.sizes.slice(0, index), half, half, ...node.sizes.slice(index + 1)],
    }
  }
  return {
    ...node,
    children: node.children.map((child) =>
      insertBeside(child, targetId, added, direction, placement, splitId),
    ),
  }
}

function neighbourTab(tabs: readonly TabId[], closed: TabId): TabId | null {
  const index = tabs.indexOf(closed)
  return tabs[index + 1] ?? tabs[index - 1] ?? null
}

function withoutPane(layout: Layout, paneId: PaneId): Layout {
  const order = leaves(layout.root)
  const index = order.findIndex((pane) => pane.id === paneId)
  const fallback = order[index - 1] ?? order[index + 1]
  const root = removePane(layout.root, paneId)
  if (!fallback || root === null) return layout
  return {
    ...layout,
    root: normalize(root),
    activePane: layout.activePane === paneId ? fallback.id : layout.activePane,
  }
}

// ---- tabs --------------------------------------------------------------------------------

/** Adds a tab to a pane (the active one by default) and activates it. A tab already open is just activated. */
export function openTab(layout: Layout, tabId: TabId, paneId: PaneId = layout.activePane): Layout {
  if (paneOfTab(layout, tabId)) return activateTab(layout, tabId)
  const target = findPane(layout, paneId)
  if (!target) return layout
  return {
    ...layout,
    root: updatePane(layout.root, target.id, (pane) => ({
      ...pane,
      tabs: [...pane.tabs, tabId],
      activeTab: tabId,
    })),
    activePane: target.id,
  }
}

export function activateTab(layout: Layout, tabId: TabId): Layout {
  const pane = paneOfTab(layout, tabId)
  if (!pane) return layout
  return {
    ...layout,
    root: updatePane(layout.root, pane.id, (current) => ({ ...current, activeTab: tabId })),
    activePane: pane.id,
  }
}

export function activatePane(layout: Layout, paneId: PaneId): Layout {
  return findPane(layout, paneId) ? { ...layout, activePane: paneId } : layout
}

/** Closes a tab. A pane left with no tabs closes too, unless it is the last pane. */
export function closeTab(layout: Layout, tabId: TabId): Layout {
  const pane = paneOfTab(layout, tabId)
  if (!pane) return layout
  const tabs = pane.tabs.filter((tab) => tab !== tabId)
  if (tabs.length === 0 && leaves(layout.root).length > 1) return withoutPane(layout, pane.id)
  const activeTab = pane.activeTab === tabId ? neighbourTab(pane.tabs, tabId) : pane.activeTab
  return {
    ...layout,
    root: updatePane(layout.root, pane.id, (current) => ({ ...current, tabs, activeTab })),
  }
}

/** Closes a pane and its tabs. The last pane stays, emptied. */
export function closePane(layout: Layout, paneId: PaneId): Layout {
  const pane = findPane(layout, paneId)
  if (!pane) return layout
  if (leaves(layout.root).length > 1) return withoutPane(layout, paneId)
  return {
    ...layout,
    root: updatePane(layout.root, paneId, (current) => ({ ...current, tabs: [], activeTab: null })),
  }
}

/**
 * Moves a tab to a place in a pane's strip, in this pane or another. `index` is the position in
 * the strip after the move; the default is the end. The moved tab becomes the active one. A pane
 * emptied by the move closes.
 */
export function moveTab(layout: Layout, tabId: TabId, toPaneId: PaneId, index?: number): Layout {
  const from = paneOfTab(layout, tabId)
  const to = findPane(layout, toPaneId)
  if (!from || !to) return layout

  const place = (tabs: readonly TabId[]): TabId[] => {
    const at = Math.min(Math.max(index ?? tabs.length, 0), tabs.length)
    return [...tabs.slice(0, at), tabId, ...tabs.slice(at)]
  }

  if (from.id === to.id) {
    const tabs = place(from.tabs.filter((tab) => tab !== tabId))
    return {
      ...layout,
      root: updatePane(layout.root, from.id, (pane) => ({ ...pane, tabs, activeTab: tabId })),
      activePane: from.id,
    }
  }

  const remaining = from.tabs.filter((tab) => tab !== tabId)
  const moved: Layout = {
    ...layout,
    root: updatePane(
      updatePane(layout.root, from.id, (pane) => ({
        ...pane,
        tabs: remaining,
        activeTab: pane.activeTab === tabId ? neighbourTab(pane.tabs, tabId) : pane.activeTab,
      })),
      to.id,
      (pane) => ({ ...pane, tabs: place(pane.tabs), activeTab: tabId }),
    ),
    activePane: to.id,
  }
  return remaining.length === 0 ? withoutPane(moved, from.id) : moved
}

/**
 * Moves a tab into a new pane on one edge of a pane, which splits that pane. Dragging the only
 * tab of a pane to its own edge changes nothing, since it would leave an empty pane behind.
 */
export function moveTabToEdge(
  layout: Layout,
  tabId: TabId,
  targetPaneId: PaneId,
  edge: Edge,
): Layout {
  const from = paneOfTab(layout, tabId)
  const target = findPane(layout, targetPaneId)
  if (!from || !target) return layout
  if (from.id === target.id && from.tabs.length === 1) return layout

  const remaining = from.tabs.filter((tab) => tab !== tabId)
  const direction: Direction = edge === 'left' || edge === 'right' ? 'row' : 'column'
  const placement: Placement = edge === 'left' || edge === 'top' ? 'before' : 'after'
  const paneId = `p${layout.nextId}`
  const splitId = `s${layout.nextId + 1}`

  const emptied = updatePane(layout.root, from.id, (pane) => ({
    ...pane,
    tabs: remaining,
    activeTab: pane.activeTab === tabId ? neighbourTab(pane.tabs, tabId) : pane.activeTab,
  }))
  const split: Layout = {
    root: insertBeside(
      emptied,
      target.id,
      emptyPane(paneId, [tabId]),
      direction,
      placement,
      splitId,
    ),
    activePane: paneId,
    nextId: layout.nextId + 2,
  }
  return remaining.length === 0 ? withoutPane(split, from.id) : split
}

// ---- splits ------------------------------------------------------------------------------

/**
 * Splits a pane. The new pane goes after (right or below) or before the target and takes half its
 * space. It holds `tabs` when given, and is empty otherwise. It becomes the active pane.
 */
export function splitPane(
  layout: Layout,
  paneId: PaneId,
  direction: Direction,
  placement: Placement = 'after',
  tabs: readonly TabId[] = [],
): Layout {
  const target = findPane(layout, paneId)
  if (!target) return layout
  if (tabs.some((tab) => paneOfTab(layout, tab))) return layout
  const id = `p${layout.nextId}`
  return {
    root: insertBeside(
      layout.root,
      paneId,
      emptyPane(id, tabs),
      direction,
      placement,
      `s${layout.nextId + 1}`,
    ),
    activePane: id,
    nextId: layout.nextId + 2,
  }
}

/**
 * Sets the sizes of a split's children from percentages. They are scaled to sum to 100. Sizes of
 * the wrong count, or any that are not above zero, change nothing.
 */
export function setSizes(layout: Layout, splitId: SplitId, sizes: readonly number[]): Layout {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (!sizes.every((size) => Number.isFinite(size) && size > 0) || total <= 0) return layout
  const scaled = sizes.map((size) => (size / total) * 100)
  const apply = (node: SplitNode): SplitNode => {
    if (node.kind === 'pane') return node
    if (node.id === splitId) {
      return node.children.length === scaled.length ? { ...node, sizes: scaled } : node
    }
    let changed = false
    const children = node.children.map((child) => {
      const next = apply(child)
      if (next !== child) changed = true
      return next
    })
    return changed ? { ...node, children } : node
  }
  const root = apply(layout.root)
  return root === layout.root ? layout : { ...layout, root }
}

// ---- checking and saving -----------------------------------------------------------------

/** Every way the layout breaks its invariants, as plain sentences. Empty means valid. */
export function validateLayout(layout: Layout): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const tabs = new Set<string>()

  const visit = (node: SplitNode, parentDirection: Direction | null): void => {
    if (ids.has(node.id)) problems.push(`id ${node.id} is used twice`)
    ids.add(node.id)
    if (node.kind === 'pane') {
      for (const tab of node.tabs) {
        if (tabs.has(tab)) problems.push(`tab ${tab} is in more than one place`)
        tabs.add(tab)
      }
      if (node.tabs.length === 0 && node.activeTab !== null) {
        problems.push(`pane ${node.id} has an active tab but no tabs`)
      }
      if (
        node.tabs.length > 0 &&
        (node.activeTab === null || !node.tabs.includes(node.activeTab))
      ) {
        problems.push(`pane ${node.id} has no valid active tab`)
      }
      return
    }
    if (node.children.length < 2) problems.push(`split ${node.id} has fewer than two children`)
    if (node.direction === parentDirection) {
      problems.push(`split ${node.id} runs the same way as its parent`)
    }
    if (node.sizes.length !== node.children.length) {
      problems.push(
        `split ${node.id} has ${node.sizes.length} sizes for ${node.children.length} children`,
      )
    }
    if (!node.sizes.every((size) => Number.isFinite(size) && size > 0)) {
      problems.push(`split ${node.id} has a size that is not above zero`)
    }
    const total = node.sizes.reduce((sum, size) => sum + size, 0)
    if (Math.abs(total - 100) > SIZE_TOLERANCE) {
      problems.push(`split ${node.id} sizes add up to ${total}, not 100`)
    }
    for (const child of node.children) visit(child, node.direction)
  }
  visit(layout.root, null)

  if (!leaves(layout.root).some((pane) => pane.id === layout.activePane)) {
    problems.push(`active pane ${layout.activePane} does not exist`)
  }
  if (!Number.isInteger(layout.nextId) || layout.nextId < 1) {
    problems.push('nextId is not a positive integer')
  }
  return problems
}

export function serialize(layout: Layout): string {
  return JSON.stringify(layout)
}

export type ParseResult = { ok: true; layout: Layout } | { ok: false; error: string }

class ParseFailure extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}

function readString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') {
    throw new ParseFailure(`${where}: "${key}" must be a non-empty string`)
  }
  return value
}

function readNode(value: unknown, where: string): SplitNode {
  if (!isRecord(value)) throw new ParseFailure(`${where}: expected an object`)
  const id = readString(value, 'id', where)
  if (value.kind === 'pane') {
    const { tabs, activeTab } = value
    if (!isStringList(tabs)) throw new ParseFailure(`${where}: "tabs" must be a list of strings`)
    if (activeTab !== null && typeof activeTab !== 'string') {
      throw new ParseFailure(`${where}: "activeTab" must be a string or null`)
    }
    return { kind: 'pane', id, tabs, activeTab }
  }
  if (value.kind === 'split') {
    const direction = value.direction
    if (direction !== 'row' && direction !== 'column') {
      throw new ParseFailure(`${where}: "direction" must be "row" or "column"`)
    }
    const { children, sizes } = value
    if (!Array.isArray(children)) throw new ParseFailure(`${where}: "children" must be a list`)
    if (!isNumberList(sizes)) throw new ParseFailure(`${where}: "sizes" must be a list of numbers`)
    return {
      kind: 'split',
      id,
      direction,
      children: children.map((child: unknown, at) => readNode(child, `${where}.children[${at}]`)),
      sizes,
    }
  }
  throw new ParseFailure(`${where}: "kind" must be "pane" or "split"`)
}

/** Reads saved text back into a layout, or says why it cannot. Saved data is untrusted until it passes. */
export function deserialize(text: string): ParseResult {
  try {
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) throw new ParseFailure('layout: expected an object')
    const { nextId } = value
    if (typeof nextId !== 'number') throw new ParseFailure('layout: "nextId" must be a number')
    const layout: Layout = {
      root: readNode(value.root, 'layout.root'),
      activePane: readString(value, 'activePane', 'layout'),
      nextId,
    }
    const [problem] = validateLayout(layout)
    if (problem) throw new ParseFailure(`layout: ${problem}`)
    return { ok: true, layout }
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, error: error.message }
    if (error instanceof SyntaxError) return { ok: false, error: `layout: ${error.message}` }
    throw error
  }
}
