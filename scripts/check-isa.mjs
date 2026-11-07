#!/usr/bin/env node
/**
 * Checks ISA.md against ai-docs/standards/isa.md.
 *
 *   node scripts/check-isa.mjs            check ISA.md at the repository root
 *   node scripts/check-isa.mjs <path>     check another ISA file (the tests do this)
 *
 * Fails on:
 *   - a `progress: M/N` that does not match the leaf claims (N total, M closed)
 *   - a duplicate claim ID, or a duplicate Test Strategy row
 *   - a leaf claim with no Test Strategy row
 *   - a Test Strategy row with no leaf claim
 *
 * A leaf claim is any claim in `## Features` that is neither a `[container]` parent nor a
 * `[DROPPED ...]` tombstone. Exit 0 when the file is consistent, 1 when it is not, 2 on bad usage.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ID = String.raw`ISC-\d+(?:\.\d+)*`
const CLAIM = new RegExp(String.raw`^\s*- \[([ xX])\] (${ID}):\s*(.*)$`)
const ROW_ID = new RegExp(`^${ID}$`)

/** The lines of one `## ` section, with their 1-based line numbers. */
function section(lines, title) {
  const found = []
  let inside = false
  let seen = false
  lines.forEach((text, i) => {
    const header = text.match(/^## (.+?)\s*$/)
    if (header) {
      inside = header[1] === title
      seen ||= inside
      return
    }
    if (inside) found.push({ text, line: i + 1 })
  })
  return seen ? found : undefined
}

function check(file) {
  const errors = []
  const fail = (line, message) => errors.push({ line, message })
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')

  const progress = lines.slice(0, 40).findIndex((l) => /^progress:/.test(l))
  const progressMatch =
    progress < 0 ? null : (lines[progress] ?? '').match(/^progress:\s*(\d+)\s*\/\s*(\d+)\s*$/)
  if (!progressMatch) {
    fail(progress < 0 ? 1 : progress + 1, 'frontmatter has no `progress: M/N`')
  }

  const features = section(lines, 'Features')
  const strategy = section(lines, 'Test Strategy')
  if (!features) fail(1, 'no `## Features` section')
  if (!strategy) fail(1, 'no `## Test Strategy` section')

  const claims = new Map()
  for (const { text, line } of features ?? []) {
    const m = text.match(CLAIM)
    if (!m) continue
    const [, mark = ' ', id = '', body = ''] = m
    if (claims.has(id)) {
      fail(line, `duplicate claim ID ${id} (first on line ${String(claims.get(id).line)})`)
      continue
    }
    const kind = body.startsWith('[container]')
      ? 'container'
      : body.startsWith('[DROPPED')
        ? 'dropped'
        : 'leaf'
    claims.set(id, { line, kind, closed: mark.toLowerCase() === 'x' })
  }

  const rows = new Map()
  for (const { text, line } of strategy ?? []) {
    if (!text.trimStart().startsWith('|')) continue
    const id = text.split('|')[1]?.trim() ?? ''
    if (!ROW_ID.test(id)) continue
    if (rows.has(id)) {
      fail(line, `duplicate Test Strategy row ${id} (first on line ${String(rows.get(id))})`)
      continue
    }
    rows.set(id, line)
  }

  let leaves = 0
  let closed = 0
  for (const [id, claim] of claims) {
    if (claim.kind !== 'leaf') continue
    leaves++
    if (claim.closed) closed++
    if (!rows.has(id)) fail(claim.line, `leaf claim ${id} has no Test Strategy row`)
  }
  for (const [id, line] of rows) {
    const claim = claims.get(id)
    if (!claim) fail(line, `Test Strategy row ${id} has no claim in ## Features`)
    else if (claim.kind !== 'leaf')
      fail(line, `Test Strategy row ${id} belongs to a ${claim.kind} claim, which needs no row`)
  }

  if (progressMatch) {
    const [, doneText = '', totalText = ''] = progressMatch
    if (Number(totalText) !== leaves) {
      fail(
        progress + 1,
        `progress total is ${totalText} but ## Features has ${String(leaves)} leaf claims`,
      )
    }
    if (Number(doneText) !== closed) {
      fail(
        progress + 1,
        `progress closed count is ${doneText} but ${String(closed)} leaf claims are checked`,
      )
    }
  }

  return { errors, leaves, closed, rows: rows.size }
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'))
  if (args.length !== argv.length || args.length > 1) {
    console.error('usage: node scripts/check-isa.mjs [path-to-ISA.md]')
    return 2
  }
  const file = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ISA.md'))
  if (!existsSync(file)) {
    console.error(`FAIL  check-isa: ${file} does not exist`)
    return 1
  }
  const { errors, leaves, closed, rows } = check(file)
  if (errors.length === 0) {
    console.log(
      `ok    check-isa: ${String(leaves)} leaf claims, ${String(closed)} closed, ${String(rows)} test rows`,
    )
    return 0
  }
  console.error('FAIL  check-isa')
  for (const { line, message } of errors)
    console.error(`        ISA.md:${String(line)}  ${message}`)
  return 1
}

process.exitCode = main(process.argv.slice(2))
